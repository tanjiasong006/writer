//! Writer 项目的磁盘存储：新建、打开、保存。
//!
//! 格式与一致性规则见 `docs/project-format.md`。核心是保存事务：
//! 所有要变化的正文先完整放进 staging，原子写入 journal 作为提交点，再幂等地应用到 content/。
//! 任何一步失败或崩溃后，下次打开/保存都会先恢复：有 journal 就前滚，没有就丢弃 staging。

pub mod assets;
pub mod fs;
pub mod lock;
mod names;
#[cfg(test)]
mod tests;

use std::collections::{BTreeMap, BTreeSet};
use std::io;
use std::path::{Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use fs::Fs;
use names::{is_content_file_name, is_staged_file_name};

const MANIFEST: &str = "writer.json";
const CONTENT_DIR: &str = "content";
const INTERNAL_DIR: &str = ".writer";
const STAGING_DIR: &str = "staging";
const RECOVERED_DIR: &str = "recovered";
const JOURNAL: &str = "journal.json";
const JOURNAL_TMP: &str = "journal.json.tmp";
const UI_STATE: &str = "ui-state.json";
const UI_STATE_TMP: &str = "ui-state.json.tmp";
const FORMAT: &str = "writer-project";
const VERSION: u64 = 1;
const JOURNAL_VERSION: u32 = 1;

/// 存储失败的原因；序列化为 `{ code, ...fields }` 交给前端映射成用户文案。
#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(
    tag = "code",
    rename_all = "kebab-case",
    rename_all_fields = "camelCase"
)]
pub enum StorageError {
    /// 目录中没有 writer.json。
    NotAProject,
    /// 新建项目的目标目录已存在且不为空。
    TargetNotEmpty,
    /// writer.json 不是合法 JSON 或结构不对。
    ManifestInvalid { detail: String },
    /// 项目由更新版本的 Writer 创建。
    VersionUnsupported,
    /// journal 损坏，无法判断如何恢复；不做任何猜测性修改。
    JournalInvalid,
    /// manifest 引用的正文文件不存在。
    ContentMissing { chapter_id: String, file: String },
    /// 正文文件不是合法 UTF-8。
    ContentNotUtf8 { chapter_id: String, file: String },
    /// 新章节没有提供正文。
    ContentRequired { chapter_id: String },
    /// 提供了不属于任何章节的正文。
    ContentOrphan { chapter_id: String },
    /// 项目已被另一个 Writer 进程打开。
    ProjectLocked,
    /// 不支持的资源格式。
    AssetUnsupported,
    /// 资源文件超过大小上限。
    AssetTooLarge,
    /// 要导入的资源文件不存在。
    AssetNotFound,
    /// 文件系统操作失败。
    Io {
        operation: String,
        path: String,
        message: String,
    },
}

type Result<T> = std::result::Result<T, StorageError>;

fn io_error(operation: &str, path: &Path) -> impl FnOnce(io::Error) -> StorageError {
    let operation = operation.to_owned();
    let path = path.display().to_string();
    move |error| StorageError::Io {
        operation,
        path,
        message: error.to_string(),
    }
}

/// 一次保存：完整的新 manifest，以及自上次成功保存后内容变化的章节正文（按 ChapterId）。
#[derive(Debug, Deserialize)]
pub struct SaveRequest {
    pub manifest: Value,
    pub contents: BTreeMap<String, String>,
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct OpenedProject {
    pub manifest: Value,
    /// ChapterId → 正文，按字节原样解码。
    pub contents: BTreeMap<String, String>,
    /// content/ 中未被 manifest 引用的文件。
    pub orphan_files: Vec<String>,
}

struct Paths {
    root: PathBuf,
    manifest: PathBuf,
    content: PathBuf,
    internal: PathBuf,
    staging: PathBuf,
    recovered: PathBuf,
    journal: PathBuf,
    journal_tmp: PathBuf,
}

impl Paths {
    fn new(root: &Path) -> Self {
        let internal = root.join(INTERNAL_DIR);
        Paths {
            root: root.to_owned(),
            manifest: root.join(MANIFEST),
            content: root.join(CONTENT_DIR),
            staging: internal.join(STAGING_DIR),
            recovered: internal.join(RECOVERED_DIR),
            journal: internal.join(JOURNAL),
            journal_tmp: internal.join(JOURNAL_TMP),
            internal,
        }
    }
}

#[derive(Debug, Serialize, Deserialize)]
struct Journal {
    version: u32,
    /// staging 文件 → content/ 中的目标文件名。
    entries: Vec<JournalEntry>,
    /// 应用后需要删除的旧正文文件名。
    deletes: Vec<String>,
}

#[derive(Debug, Serialize, Deserialize)]
struct JournalEntry {
    staged: String,
    target: String,
}

/// 在一个不存在或为空的目录中新建项目。
pub fn create_project(fs: &dyn Fs, root: &Path, request: &SaveRequest) -> Result<()> {
    let paths = Paths::new(root);
    if fs.exists(&paths.journal) {
        recover(fs, &paths)?;
    }
    ensure_empty_target(root)?;
    let new_files = manifest_files(&request.manifest)?;
    fs.create_dir_all(root)
        .map_err(io_error("create-dir", root))?;
    transact(fs, &paths, &BTreeMap::new(), &new_files, request)
}

/// 打开项目：先恢复未完成的保存，再读取 manifest 与全部正文。
pub fn open_project(fs: &dyn Fs, root: &Path) -> Result<OpenedProject> {
    let paths = Paths::new(root);
    if !fs.exists(&paths.manifest) && !fs.exists(&paths.journal) {
        return Err(StorageError::NotAProject);
    }
    recover(fs, &paths)?;

    let manifest = read_manifest(fs, &paths)?;
    let files = manifest_files(&manifest)?;

    let mut contents = BTreeMap::new();
    for (chapter_id, file) in &files {
        let path = paths.content.join(file);
        let bytes = fs.read(&path).map_err(|error| match error.kind() {
            io::ErrorKind::NotFound => StorageError::ContentMissing {
                chapter_id: chapter_id.clone(),
                file: file.clone(),
            },
            _ => io_error("read", &path)(error),
        })?;
        let text = String::from_utf8(bytes).map_err(|_| StorageError::ContentNotUtf8 {
            chapter_id: chapter_id.clone(),
            file: file.clone(),
        })?;
        contents.insert(chapter_id.clone(), text);
    }

    let referenced: BTreeSet<&String> = files.values().collect();
    let orphan_files = match fs.list_files(&paths.content) {
        Ok(names) => names
            .into_iter()
            .filter(|name| !name.starts_with('.') && !referenced.contains(name))
            .collect(),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Vec::new(),
        Err(error) => return Err(io_error("list", &paths.content)(error)),
    };

    Ok(OpenedProject {
        manifest,
        contents,
        orphan_files,
    })
}

/// 保存项目：旧的文件对应关系一律从磁盘读取，不信任调用方的记忆。
pub fn save_project(fs: &dyn Fs, root: &Path, request: &SaveRequest) -> Result<()> {
    let paths = Paths::new(root);
    if !fs.exists(&paths.manifest) && !fs.exists(&paths.journal) {
        return Err(StorageError::NotAProject);
    }
    recover(fs, &paths)?;
    let new_files = manifest_files(&request.manifest)?;
    let old_files = manifest_files(&read_manifest(fs, &paths)?)?;
    transact(fs, &paths, &old_files, &new_files, request)
}

/// 读取界面状态（选中章节、折叠状态等）。不存在或无法解码时返回 None：界面状态丢失不影响文档。
pub fn read_ui_state(fs: &dyn Fs, root: &Path) -> Result<Option<String>> {
    let paths = Paths::new(root);
    if !fs.exists(&paths.manifest) {
        return Err(StorageError::NotAProject);
    }
    match fs.read(&paths.internal.join(UI_STATE)) {
        Ok(bytes) => Ok(String::from_utf8(bytes).ok()),
        Err(_) => Ok(None),
    }
}

/// 写入界面状态：独立于保存事务，经临时文件原子替换，失败不影响文档数据。
pub fn write_ui_state(fs: &dyn Fs, root: &Path, state: &str) -> Result<()> {
    let paths = Paths::new(root);
    if !fs.exists(&paths.manifest) {
        return Err(StorageError::NotAProject);
    }
    fs.create_dir_all(&paths.internal)
        .map_err(io_error("create-dir", &paths.internal))?;
    let tmp = paths.internal.join(UI_STATE_TMP);
    let target = paths.internal.join(UI_STATE);
    fs.write_synced(&tmp, state.as_bytes())
        .map_err(io_error("write", &tmp))?;
    fs.rename(&tmp, &target)
        .map_err(io_error("rename", &target))
}

fn read_manifest(fs: &dyn Fs, paths: &Paths) -> Result<Value> {
    let bytes = fs
        .read(&paths.manifest)
        .map_err(|error| match error.kind() {
            io::ErrorKind::NotFound => StorageError::NotAProject,
            _ => io_error("read", &paths.manifest)(error),
        })?;
    serde_json::from_slice(&bytes).map_err(|error| StorageError::ManifestInvalid {
        detail: error.to_string(),
    })
}

/// 从 manifest 中取出 ChapterId → 文件名，并校验格式、版本、文件名合法且互不重复。
/// 章节树本身的校验在前端信任边界（parseManifest）完成，这里只关心与磁盘相关的部分。
fn manifest_files(manifest: &Value) -> Result<BTreeMap<String, String>> {
    let invalid = |detail: &str| StorageError::ManifestInvalid {
        detail: detail.to_owned(),
    };
    let object = manifest
        .as_object()
        .ok_or_else(|| invalid("not an object"))?;
    if object.get("format").and_then(Value::as_str) != Some(FORMAT) {
        return Err(invalid("unknown format"));
    }
    match object.get("version").and_then(Value::as_u64) {
        Some(VERSION) => {}
        Some(version) if version > VERSION => return Err(StorageError::VersionUnsupported),
        _ => return Err(invalid("invalid version")),
    }
    let files = object
        .get("files")
        .and_then(Value::as_object)
        .ok_or_else(|| invalid("files is not an object"))?;

    let mut result = BTreeMap::new();
    let mut names = BTreeSet::new();
    for (chapter_id, name) in files {
        let name = name
            .as_str()
            .ok_or_else(|| invalid("file name is not a string"))?;
        if !is_content_file_name(name) {
            return Err(invalid("invalid file name"));
        }
        if !names.insert(name) {
            return Err(invalid("duplicate file name"));
        }
        result.insert(chapter_id.clone(), name.to_owned());
    }
    Ok(result)
}

/// 新建项目的目标必须不存在，或是只含系统杂项 / 未完成的内部目录的空目录。
fn ensure_empty_target(root: &Path) -> Result<()> {
    let entries = match std::fs::read_dir(root) {
        Ok(entries) => entries,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(()),
        Err(error) if error.kind() == io::ErrorKind::NotADirectory => {
            return Err(StorageError::TargetNotEmpty)
        }
        Err(error) => return Err(io_error("list", root)(error)),
    };
    for entry in entries {
        let entry = entry.map_err(io_error("list", root))?;
        let name = entry.file_name();
        if name != INTERNAL_DIR && name != ".DS_Store" {
            return Err(StorageError::TargetNotEmpty);
        }
    }
    Ok(())
}

/// 保存事务：准备 staging → 原子写入 journal（提交点）→ 应用。
fn transact(
    fs: &dyn Fs,
    paths: &Paths,
    old_files: &BTreeMap<String, String>,
    new_files: &BTreeMap<String, String>,
    request: &SaveRequest,
) -> Result<()> {
    if let Some(chapter_id) = request
        .contents
        .keys()
        .find(|id| !new_files.contains_key(*id))
    {
        return Err(StorageError::ContentOrphan {
            chapter_id: chapter_id.clone(),
        });
    }

    // 1. 清理上次可能残留的 staging，准备目录。
    discard_staging(fs, paths)?;
    fs.create_dir_all(&paths.staging)
        .map_err(io_error("create-dir", &paths.staging))?;

    let old_names: BTreeSet<&String> = old_files.values().collect();
    let new_names: BTreeSet<&String> = new_files.values().collect();

    // 2. 准备：把所有要变化的正文完整放进 staging。content/ 与 writer.json 保持不动。
    let mut entries = Vec::new();
    for (index, (chapter_id, target)) in new_files.iter().enumerate() {
        let staged = format!("{index}.md");
        let staged_path = paths.staging.join(&staged);
        match (request.contents.get(chapter_id), old_files.get(chapter_id)) {
            (Some(text), _) => fs
                .write_synced(&staged_path, text.as_bytes())
                .map_err(io_error("write", &staged_path))?,
            (None, Some(old)) if old == target => continue,
            (None, Some(old)) => {
                // 只是编号变化：按字节保留原文件，不经过任何解码或规范化。
                let source = paths.content.join(old);
                fs.link_or_copy(&source, &staged_path)
                    .map_err(|error| match error.kind() {
                        io::ErrorKind::NotFound => StorageError::ContentMissing {
                            chapter_id: chapter_id.clone(),
                            file: old.clone(),
                        },
                        _ => io_error("copy", &source)(error),
                    })?
            }
            (None, None) => {
                return Err(StorageError::ContentRequired {
                    chapter_id: chapter_id.clone(),
                })
            }
        }
        if !old_names.contains(target) {
            preserve_orphan(fs, paths, target)?;
        }
        entries.push(JournalEntry {
            staged,
            target: target.clone(),
        });
    }

    let deletes: Vec<String> = old_names
        .difference(&new_names)
        .map(|name| (*name).clone())
        .collect();

    let manifest_bytes = serde_json::to_vec_pretty(&request.manifest).map_err(|error| {
        StorageError::ManifestInvalid {
            detail: error.to_string(),
        }
    })?;
    let staged_manifest = paths.staging.join(MANIFEST);
    fs.write_synced(&staged_manifest, &manifest_bytes)
        .map_err(io_error("write", &staged_manifest))?;
    fs.sync_dir(&paths.staging)
        .map_err(io_error("sync", &paths.staging))?;

    // 3. 提交点：journal 经临时文件 + rename 原子出现。此后磁盘状态确定为新状态。
    let journal = Journal {
        version: JOURNAL_VERSION,
        entries,
        deletes,
    };
    let journal_bytes = serde_json::to_vec(&journal).expect("journal is serializable");
    fs.write_synced(&paths.journal_tmp, &journal_bytes)
        .map_err(io_error("write", &paths.journal_tmp))?;
    fs.rename(&paths.journal_tmp, &paths.journal)
        .map_err(io_error("rename", &paths.journal))?;
    fs.sync_dir(&paths.internal)
        .map_err(io_error("sync", &paths.internal))?;

    // 4. 应用。失败时 journal 仍在，下次打开或保存会前滚。
    apply(fs, paths, &journal)
}

/// 目标文件名被未登记的文件占用时，先把它移到 .writer/recovered/，绝不覆盖用户数据。
fn preserve_orphan(fs: &dyn Fs, paths: &Paths, name: &str) -> Result<()> {
    let occupied = paths.content.join(name);
    if !fs.exists(&occupied) {
        return Ok(());
    }
    fs.create_dir_all(&paths.recovered)
        .map_err(io_error("create-dir", &paths.recovered))?;
    let stamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |d| d.as_millis());
    let mut destination = paths.recovered.join(format!("{stamp}-{name}"));
    let mut counter = 1;
    while fs.exists(&destination) {
        destination = paths.recovered.join(format!("{stamp}-{counter}-{name}"));
        counter += 1;
    }
    fs.rename(&occupied, &destination)
        .map_err(io_error("rename", &occupied))
}

/// 应用已提交的 journal。幂等：已完成的步骤再次执行时被跳过。
fn apply(fs: &dyn Fs, paths: &Paths, journal: &Journal) -> Result<()> {
    fs.create_dir_all(&paths.content)
        .map_err(io_error("create-dir", &paths.content))?;
    for entry in &journal.entries {
        let staged = paths.staging.join(&entry.staged);
        if fs.exists(&staged) {
            let target = paths.content.join(&entry.target);
            fs.rename(&staged, &target)
                .map_err(io_error("rename", &target))?;
        }
    }
    for name in &journal.deletes {
        let path = paths.content.join(name);
        match fs.remove_file(&path) {
            Ok(()) => {}
            Err(error) if error.kind() == io::ErrorKind::NotFound => {}
            Err(error) => return Err(io_error("remove", &path)(error)),
        }
    }
    fs.sync_dir(&paths.content)
        .map_err(io_error("sync", &paths.content))?;

    let staged_manifest = paths.staging.join(MANIFEST);
    if fs.exists(&staged_manifest) {
        fs.rename(&staged_manifest, &paths.manifest)
            .map_err(io_error("rename", &paths.manifest))?;
    }
    fs.sync_dir(&paths.root)
        .map_err(io_error("sync", &paths.root))?;

    fs.remove_file(&paths.journal)
        .map_err(io_error("remove", &paths.journal))?;
    fs.sync_dir(&paths.internal)
        .map_err(io_error("sync", &paths.internal))?;

    // 事务已完整结束；staging 清理失败无害，下次保存前会再清。
    let _ = fs.remove_dir_all(&paths.staging);
    Ok(())
}

/// 恢复：有 journal 就前滚；没有就说明事务未提交，丢弃 staging 残留。
fn recover(fs: &dyn Fs, paths: &Paths) -> Result<()> {
    if !fs.exists(&paths.journal) {
        return discard_staging(fs, paths);
    }
    let bytes = fs
        .read(&paths.journal)
        .map_err(io_error("read", &paths.journal))?;
    let journal: Journal =
        serde_json::from_slice(&bytes).map_err(|_| StorageError::JournalInvalid)?;
    let names_valid = journal.version == JOURNAL_VERSION
        && journal
            .entries
            .iter()
            .all(|e| is_staged_file_name(&e.staged) && is_content_file_name(&e.target))
        && journal
            .deletes
            .iter()
            .all(|name| is_content_file_name(name));
    if !names_valid {
        return Err(StorageError::JournalInvalid);
    }
    apply(fs, paths, &journal)
}

fn discard_staging(fs: &dyn Fs, paths: &Paths) -> Result<()> {
    if fs.exists(&paths.staging) {
        fs.remove_dir_all(&paths.staging)
            .map_err(io_error("remove", &paths.staging))?;
    }
    if fs.exists(&paths.journal_tmp) {
        fs.remove_file(&paths.journal_tmp)
            .map_err(io_error("remove", &paths.journal_tmp))?;
    }
    Ok(())
}
