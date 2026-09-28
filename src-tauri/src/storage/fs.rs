//! 存储层使用的文件系统操作。
//!
//! 所有会改变磁盘的操作都经过 `Fs`，测试可以注入"第 N 步失败"来验证保存事务在任意位置
//! 失败或崩溃后都能恢复到一致状态。

use std::fs::{self, File};
use std::io::{self, Write};
use std::path::Path;

pub trait Fs {
    fn read(&self, path: &Path) -> io::Result<Vec<u8>>;
    /// 创建或截断文件，写入全部数据并 fsync。
    fn write_synced(&self, path: &Path, data: &[u8]) -> io::Result<()>;
    /// 让 `to` 拥有与 `from` 相同的字节：优先硬链接（不复制数据），不支持时复制并 fsync。
    fn link_or_copy(&self, from: &Path, to: &Path) -> io::Result<()>;
    /// 原子重命名；目标存在时被替换。
    fn rename(&self, from: &Path, to: &Path) -> io::Result<()>;
    fn remove_file(&self, path: &Path) -> io::Result<()>;
    fn create_dir_all(&self, path: &Path) -> io::Result<()>;
    fn remove_dir_all(&self, path: &Path) -> io::Result<()>;
    /// 把目录项的变化（创建、重命名、删除）持久化。
    fn sync_dir(&self, path: &Path) -> io::Result<()>;
    fn exists(&self, path: &Path) -> bool;
    /// 列出目录中的文件名（不含子目录）。
    fn list_files(&self, path: &Path) -> io::Result<Vec<String>>;
}

/// 真实文件系统。
pub struct RealFs;

impl Fs for RealFs {
    fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
        fs::read(path)
    }

    fn write_synced(&self, path: &Path, data: &[u8]) -> io::Result<()> {
        let mut file = File::create(path)?;
        file.write_all(data)?;
        file.sync_all()
    }

    fn link_or_copy(&self, from: &Path, to: &Path) -> io::Result<()> {
        match fs::hard_link(from, to) {
            Ok(()) => Ok(()),
            Err(error) if error.kind() == io::ErrorKind::NotFound => Err(error),
            Err(_) => {
                // 文件系统不支持硬链接（如 exFAT）时退回复制。
                let data = fs::read(from)?;
                self.write_synced(to, &data)
            }
        }
    }

    fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
        fs::rename(from, to)
    }

    fn remove_file(&self, path: &Path) -> io::Result<()> {
        fs::remove_file(path)
    }

    fn create_dir_all(&self, path: &Path) -> io::Result<()> {
        fs::create_dir_all(path)
    }

    fn remove_dir_all(&self, path: &Path) -> io::Result<()> {
        fs::remove_dir_all(path)
    }

    #[cfg(unix)]
    fn sync_dir(&self, path: &Path) -> io::Result<()> {
        File::open(path)?.sync_all()
    }

    #[cfg(not(unix))]
    fn sync_dir(&self, _path: &Path) -> io::Result<()> {
        // Windows 无法以普通方式打开目录做 fsync；NTFS 的元数据日志保证重命名的原子性。
        Ok(())
    }

    fn exists(&self, path: &Path) -> bool {
        fs::symlink_metadata(path).is_ok()
    }

    fn list_files(&self, path: &Path) -> io::Result<Vec<String>> {
        let mut names = Vec::new();
        for entry in fs::read_dir(path)? {
            let entry = entry?;
            if entry.file_type()?.is_file() {
                if let Some(name) = entry.file_name().to_str() {
                    names.push(name.to_owned());
                }
            }
        }
        names.sort();
        Ok(names)
    }
}

#[cfg(test)]
pub mod faulty {
    use super::{Fs, RealFs};
    use std::cell::Cell;
    use std::io;
    use std::path::Path;

    /// 在第 `fail_at` 次操作时失败，之后所有操作都失败，模拟进程在该点崩溃。
    /// 失败的写入会留下写了一半的文件，模拟真实的部分写入。
    pub struct FaultyFs {
        fail_at: usize,
        count: Cell<usize>,
    }

    impl FaultyFs {
        pub fn failing_at(fail_at: usize) -> Self {
            FaultyFs {
                fail_at,
                count: Cell::new(0),
            }
        }

        /// 本次运行中尝试过的操作数；小于等于 fail_at 说明没有注入到故障。
        pub fn operations(&self) -> usize {
            self.count.get()
        }

        fn step(&self) -> io::Result<()> {
            let n = self.count.get();
            self.count.set(n + 1);
            if n >= self.fail_at {
                Err(io::Error::other("injected failure"))
            } else {
                Ok(())
            }
        }
    }

    impl Fs for FaultyFs {
        fn read(&self, path: &Path) -> io::Result<Vec<u8>> {
            self.step()?;
            RealFs.read(path)
        }

        fn write_synced(&self, path: &Path, data: &[u8]) -> io::Result<()> {
            if let Err(error) = self.step() {
                let _ = std::fs::write(path, &data[..data.len() / 2]);
                return Err(error);
            }
            RealFs.write_synced(path, data)
        }

        fn link_or_copy(&self, from: &Path, to: &Path) -> io::Result<()> {
            self.step()?;
            RealFs.link_or_copy(from, to)
        }

        fn rename(&self, from: &Path, to: &Path) -> io::Result<()> {
            self.step()?;
            RealFs.rename(from, to)
        }

        fn remove_file(&self, path: &Path) -> io::Result<()> {
            self.step()?;
            RealFs.remove_file(path)
        }

        fn create_dir_all(&self, path: &Path) -> io::Result<()> {
            self.step()?;
            RealFs.create_dir_all(path)
        }

        fn remove_dir_all(&self, path: &Path) -> io::Result<()> {
            self.step()?;
            RealFs.remove_dir_all(path)
        }

        fn sync_dir(&self, path: &Path) -> io::Result<()> {
            self.step()?;
            RealFs.sync_dir(path)
        }

        fn exists(&self, path: &Path) -> bool {
            RealFs.exists(path)
        }

        fn list_files(&self, path: &Path) -> io::Result<Vec<String>> {
            self.step()?;
            RealFs.list_files(path)
        }
    }
}
