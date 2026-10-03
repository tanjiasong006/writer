//! 版本快照（docs/project-format.md 第 7.1 节）：项目在某一时刻的完整内容（manifest 与全部正文），
//! 每个版本一个 JSON 文件 `.writer/snapshots/<毫秒时间戳>.json`。
//!
//! - 快照取自磁盘上已提交的状态（先执行未完成保存的恢复），调用方在创建前先保存。
//! - 写入经临时文件原子替换；损坏或无法识别的快照在列表中忽略，不影响项目。
//! - 自动快照最多保留 `MAX_AUTO` 个（最旧的先删除）；手动命名的与恢复前自动留下的版本不自动删除。
//! - 恢复不在这里进行：读出快照后由前端作为一次普通修改提交（正常保存事务）。

use std::collections::BTreeMap;
use std::io;
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use super::fs::Fs;
use super::{io_error, open_project, OpenedProject, Paths, Result, StorageError};

const SNAPSHOTS_DIR: &str = "snapshots";
const SNAPSHOT_TMP: &str = "snapshot.tmp";
const FORMAT: &str = "writer-snapshot";
const VERSION: u32 = 1;
/// 自动快照最多保留的数量。
pub const MAX_AUTO: usize = 30;

/// 快照的来源。
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "kebab-case")]
pub enum SnapshotKind {
    /// 用户保存并命名的版本。
    Manual,
    /// 打开项目时每天自动留下的版本。
    Auto,
    /// 恢复其他版本之前自动留下的当前版本。
    BeforeRestore,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotFile {
    format: String,
    version: u32,
    created_at: u64,
    label: String,
    kind: SnapshotKind,
    manifest: Value,
    contents: BTreeMap<String, String>,
}

/// 列表中的一个版本。
#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    pub id: String,
    /// 创建时间（Unix 毫秒）。
    pub created_at: u64,
    pub label: String,
    pub kind: SnapshotKind,
    /// 文档标题与章节数量（列表中显示）。
    pub title: String,
    pub chapters: usize,
    /// 正文的字符数（不含空白），用于比较版本。
    pub characters: usize,
}

fn directory(root: &Path) -> PathBuf {
    Paths::new(root).internal.join(SNAPSHOTS_DIR)
}

/// 快照标识只能是时间戳数字，防止路径穿越。
fn file_for(root: &Path, id: &str) -> Result<PathBuf> {
    if id.is_empty() || !id.bytes().all(|b| b.is_ascii_digit()) {
        return Err(StorageError::SnapshotNotFound);
    }
    Ok(directory(root).join(format!("{id}.json")))
}

fn info(id: String, file: &SnapshotFile) -> SnapshotInfo {
    let chapters = file.manifest.get("files").and_then(Value::as_object).map_or(0, |files| files.len());
    let title = file.manifest.get("title").and_then(Value::as_str).unwrap_or("").to_owned();
    let characters = file.contents.values().map(|text| text.chars().filter(|c| !c.is_whitespace()).count()).sum();
    SnapshotInfo { id, created_at: file.created_at, label: file.label.clone(), kind: file.kind, title, chapters, characters }
}

/// 把磁盘上已提交的项目状态保存为一个版本。now 是当前时间（Unix 毫秒），同一毫秒内重复创建时顺延。
pub fn create_snapshot(fs: &dyn Fs, root: &Path, label: &str, kind: SnapshotKind, now: u64) -> Result<SnapshotInfo> {
    let opened = open_project(fs, root)?;
    let dir = directory(root);
    fs.create_dir_all(&dir).map_err(io_error("create-dir", &dir))?;
    let mut created_at = now;
    while fs.exists(&dir.join(format!("{created_at}.json"))) {
        created_at += 1;
    }
    let file = SnapshotFile {
        format: FORMAT.to_owned(),
        version: VERSION,
        created_at,
        label: label.trim().to_owned(),
        kind,
        manifest: opened.manifest,
        contents: opened.contents,
    };
    let bytes = serde_json::to_vec(&file).map_err(|error| StorageError::Io {
        operation: "encode".into(),
        path: dir.display().to_string(),
        kind: crate::io_kind::IoKind::Other,
        message: error.to_string(),
    })?;
    let tmp = Paths::new(root).internal.join(SNAPSHOT_TMP);
    let target = dir.join(format!("{created_at}.json"));
    fs.write_synced(&tmp, &bytes).map_err(io_error("write", &tmp))?;
    fs.rename(&tmp, &target).map_err(io_error("rename", &target))?;
    if kind == SnapshotKind::Auto {
        prune_auto(fs, root);
    }
    Ok(info(created_at.to_string(), &file))
}

fn read_file(fs: &dyn Fs, path: &Path) -> Option<SnapshotFile> {
    let file: SnapshotFile = serde_json::from_slice(&fs.read(path).ok()?).ok()?;
    (file.format == FORMAT && file.version == VERSION).then_some(file)
}

/// 全部版本，最新的在前。无法读取的快照忽略。
pub fn list_snapshots(fs: &dyn Fs, root: &Path) -> Result<Vec<SnapshotInfo>> {
    let dir = directory(root);
    let names = match fs.list_files(&dir) {
        Ok(names) => names,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(Vec::new()),
        Err(error) => return Err(io_error("list", &dir)(error)),
    };
    let mut list: Vec<SnapshotInfo> = names
        .into_iter()
        .filter_map(|name| {
            let id = name.strip_suffix(".json")?.to_owned();
            if !id.bytes().all(|b| b.is_ascii_digit()) || id.is_empty() {
                return None;
            }
            let file = read_file(fs, &dir.join(&name))?;
            Some(info(id, &file))
        })
        .collect();
    list.sort_by(|a, b| b.created_at.cmp(&a.created_at));
    Ok(list)
}

/// 读出一个版本的内容（与打开项目的结果形状相同，由前端同样校验）。
pub fn read_snapshot(fs: &dyn Fs, root: &Path, id: &str) -> Result<OpenedProject> {
    let path = file_for(root, id)?;
    let file = read_file(fs, &path).ok_or(StorageError::SnapshotNotFound)?;
    Ok(OpenedProject { manifest: file.manifest, contents: file.contents, orphan_files: Vec::new() })
}

pub fn delete_snapshot(fs: &dyn Fs, root: &Path, id: &str) -> Result<()> {
    let path = file_for(root, id)?;
    match fs.remove_file(&path) {
        Ok(()) => Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Err(StorageError::SnapshotNotFound),
        Err(error) => Err(io_error("remove", &path)(error)),
    }
}

/// 自动快照超过上限时删除最旧的（尽力而为）。
fn prune_auto(fs: &dyn Fs, root: &Path) {
    let Ok(list) = list_snapshots(fs, root) else { return };
    let autos: Vec<&SnapshotInfo> = list.iter().filter(|info| info.kind == SnapshotKind::Auto).collect();
    for old in autos.iter().skip(MAX_AUTO) {
        if let Ok(path) = file_for(root, &old.id) {
            let _ = fs.remove_file(&path);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::fs::RealFs;
    use crate::storage::{create_project, save_project, SaveRequest};
    use serde_json::json;
    use tempfile::TempDir;

    fn request(title: &str, text: &str) -> SaveRequest {
        SaveRequest {
            manifest: json!({
                "format": "writer-project", "version": 1, "title": title,
                "chapters": [{ "id": "a", "title": "一", "children": [] }],
                "files": { "a": "ch_1.md" }
            }),
            contents: BTreeMap::from([("a".to_owned(), text.to_owned())]),
        }
    }

    #[test]
    fn create_list_read_and_delete() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("项目");
        create_project(&RealFs, &root, &request("论文", "第一版")).unwrap();
        let first = create_snapshot(&RealFs, &root, " 初稿 ", SnapshotKind::Manual, 1000).unwrap();
        assert_eq!((first.label.as_str(), first.chapters, first.characters, first.title.as_str()), ("初稿", 1, 3, "论文"));
        save_project(&RealFs, &root, &request("论文", "第二版改")).unwrap();
        let second = create_snapshot(&RealFs, &root, "", SnapshotKind::Auto, 1000).unwrap();
        // 同一毫秒内顺延。
        assert_eq!(second.id, "1001");

        let list = list_snapshots(&RealFs, &root).unwrap();
        assert_eq!(list.iter().map(|info| info.id.as_str()).collect::<Vec<_>>(), vec!["1001", "1000"]);
        let old = read_snapshot(&RealFs, &root, "1000").unwrap();
        assert_eq!(old.contents["a"], "第一版");
        assert_eq!(old.manifest["title"], "论文");

        delete_snapshot(&RealFs, &root, "1000").unwrap();
        assert_eq!(list_snapshots(&RealFs, &root).unwrap().len(), 1);
        assert!(matches!(read_snapshot(&RealFs, &root, "1000"), Err(StorageError::SnapshotNotFound)));
        assert!(matches!(read_snapshot(&RealFs, &root, "../writer"), Err(StorageError::SnapshotNotFound)));
    }

    #[test]
    fn corrupt_files_are_ignored_and_old_auto_snapshots_are_pruned() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("项目");
        create_project(&RealFs, &root, &request("论文", "正文")).unwrap();
        create_snapshot(&RealFs, &root, "保留", SnapshotKind::Manual, 1).unwrap();
        for i in 0..(MAX_AUTO + 3) {
            create_snapshot(&RealFs, &root, "", SnapshotKind::Auto, 100 + i as u64).unwrap();
        }
        std::fs::write(directory(&root).join("5.json"), "{坏的").unwrap();
        let list = list_snapshots(&RealFs, &root).unwrap();
        assert_eq!(list.iter().filter(|info| info.kind == SnapshotKind::Auto).count(), MAX_AUTO);
        assert!(list.iter().any(|info| info.label == "保留"));
        assert_eq!(list.last().unwrap().id, "1");
    }

    #[test]
    fn missing_directory_lists_nothing() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("项目");
        create_project(&RealFs, &root, &request("论文", "")).unwrap();
        assert!(list_snapshots(&RealFs, &root).unwrap().is_empty());
    }
}
