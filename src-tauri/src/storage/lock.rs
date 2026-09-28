//! 项目独占锁：同一个项目同一时间只能被一个 Writer 进程打开。
//!
//! 两个进程同时编辑同一项目时，每次保存事务各自一致，但会互相覆盖对方的修改。
//! 这里对 `.writer/lock` 加操作系统级的独占锁（advisory lock），持有到项目关闭；
//! 进程退出或崩溃时由操作系统自动释放，不会留下需要人工清理的陈旧锁。
//! 文件系统不支持加锁（部分网络盘）时不阻止打开。

use std::fs::{File, OpenOptions, TryLockError};
use std::path::Path;

use super::{io_error, Paths, Result, StorageError};

/// 持有期间项目被本进程独占；drop 时释放。
#[derive(Debug)]
pub struct ProjectLock {
    _file: File,
}

pub fn acquire(root: &Path) -> Result<ProjectLock> {
    let paths = Paths::new(root);
    // 不是项目的目录不创建任何文件（不能在用户随意选择的文件夹里留下 .writer/）。
    if !paths.manifest.exists() && !paths.journal.exists() {
        return Err(StorageError::NotAProject);
    }
    std::fs::create_dir_all(&paths.internal).map_err(io_error("create-dir", &paths.internal))?;
    let path = paths.internal.join("lock");
    let file = OpenOptions::new()
        .create(true)
        .truncate(false)
        .write(true)
        .open(&path)
        .map_err(io_error("open", &path))?;
    match file.try_lock() {
        Ok(()) => Ok(ProjectLock { _file: file }),
        Err(TryLockError::WouldBlock) => Err(StorageError::ProjectLocked),
        // 不支持加锁的文件系统：无法保护，但也不应阻止用户打开自己的文档。
        Err(TryLockError::Error(_)) => Ok(ProjectLock { _file: file }),
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn second_lock_is_refused_until_the_first_is_released() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("项目");
        std::fs::create_dir_all(&root).unwrap();
        std::fs::write(root.join("writer.json"), "{}").unwrap();

        let first = acquire(&root).unwrap();
        assert!(matches!(acquire(&root), Err(StorageError::ProjectLocked)));
        drop(first);
        assert!(acquire(&root).is_ok());
    }

    #[test]
    fn non_project_directories_are_left_untouched() {
        let dir = TempDir::new().unwrap();
        assert!(matches!(acquire(dir.path()), Err(StorageError::NotAProject)));
        assert_eq!(std::fs::read_dir(dir.path()).unwrap().count(), 0);
    }
}
