//! 暴露给前端的 Tauri command。只做参数转换与线程调度，业务规则在各模块内。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::Manager;

use crate::export::pdf_layout::PdfLayout;
use crate::export::{self, ExportError, ExportReport};
use crate::render::{self, RenderRequest};
use crate::storage::{self, fs::RealFs, OpenedProject, SaveRequest, StorageError};

/// 存储操作串行执行：即使前端意外并发调用，也不会有两个事务同时改写同一项目。
static STORAGE_LOCK: Mutex<()> = Mutex::new(());

async fn run_storage<T: Send + 'static>(
    job: impl FnOnce() -> Result<T, StorageError> + Send + 'static,
) -> Result<T, StorageError> {
    tauri::async_runtime::spawn_blocking(move || {
        let _guard = STORAGE_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        job()
    })
    .await
    .unwrap_or_else(|error| {
        Err(StorageError::Io {
            operation: "task".into(),
            path: String::new(),
            kind: crate::io_kind::IoKind::Other,
            message: error.to_string(),
        })
    })
}

#[tauri::command]
pub async fn project_create(
    app: tauri::AppHandle,
    path: PathBuf,
    request: SaveRequest,
) -> Result<(), StorageError> {
    run_storage(move || {
        storage::create_project(&RealFs, &path, &request)?;
        let lock = lock_project(&path)?;
        allow_project_files(&app, &path);
        hold_lock(path, lock);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn project_open(
    app: tauri::AppHandle,
    path: PathBuf,
) -> Result<OpenedProject, StorageError> {
    run_storage(move || {
        let lock = lock_project(&path)?;
        let opened = storage::open_project(&RealFs, &path)?;
        allow_project_files(&app, &path);
        hold_lock(path, lock);
        Ok(opened)
    })
    .await
}

/// 把项目目录加入 asset 协议的允许范围：编辑器中的图片由 webview 直接读取项目内的文件。
/// 必须在打开 / 新建项目时就加入，编辑器一挂载就会加载图片。
fn allow_project_files(app: &tauri::AppHandle, path: &Path) {
    let _ = app.asset_protocol_scope().allow_directory(path, true);
}

/// 当前打开项目的独占锁。应用一次只打开一个项目，切换项目时替换。
static PROJECT_LOCK: Mutex<Option<(PathBuf, storage::lock::ProjectLock)>> = Mutex::new(None);

/// 为 path 取得独占锁；本进程已持有同一项目的锁时直接复用。
fn lock_project(path: &Path) -> Result<Option<storage::lock::ProjectLock>, StorageError> {
    let held = PROJECT_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if held.as_ref().is_some_and(|(locked, _)| locked == path) {
        return Ok(None);
    }
    drop(held);
    storage::lock::acquire(path).map(Some)
}

/// 打开成功后才替换持有的锁：打开失败时保留原项目的锁。
fn hold_lock(path: PathBuf, lock: Option<storage::lock::ProjectLock>) {
    if let Some(lock) = lock {
        *PROJECT_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner()) = Some((path, lock));
    }
}

/// 关闭项目时释放独占锁。
#[tauri::command]
pub fn project_close(path: PathBuf) {
    let mut held = PROJECT_LOCK
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner());
    if held.as_ref().is_some_and(|(locked, _)| *locked == path) {
        *held = None;
    }
}

/// 应用级状态（上次打开的项目、本机界面偏好）与应用环境；保存在 identifier 对应的配置目录中（见 app_env）。
#[tauri::command]
pub fn app_state_read(app: tauri::AppHandle) -> Result<crate::app_env::AppStateSnapshot, String> {
    let dir = crate::app_env::state_dir(&app)?;
    // 运行时的配置（开发构建已换成 "Writer Dev"）；package_info 是编译时的名称，不随之改变。
    let name = app.config().product_name.clone().unwrap_or_else(|| "Writer".into());
    Ok(crate::app_env::snapshot(&dir, name))
}

#[tauri::command]
pub async fn app_state_write(app: tauri::AppHandle, state: String) -> Result<(), String> {
    let dir = crate::app_env::state_dir(&app)?;
    tauri::async_runtime::spawn_blocking(move || crate::app_env::write_state(&dir, &state))
        .await
        .map_err(|error| error.to_string())?
        .map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn project_save(path: PathBuf, request: SaveRequest) -> Result<(), StorageError> {
    run_storage(move || storage::save_project(&RealFs, &path, &request)).await
}

#[tauri::command]
pub async fn project_read_ui_state(path: PathBuf) -> Result<Option<String>, StorageError> {
    run_storage(move || storage::read_ui_state(&RealFs, &path)).await
}

#[tauri::command]
pub async fn project_write_ui_state(path: PathBuf, state: String) -> Result<(), StorageError> {
    run_storage(move || storage::write_ui_state(&RealFs, &path, &state)).await
}

#[tauri::command]
pub async fn project_import_asset(path: PathBuf, source: PathBuf) -> Result<String, StorageError> {
    run_storage(move || storage::assets::import_asset(&RealFs, &path, &source)).await
}

/// 导入粘贴或拖入的图片：正文是图片数据（原始字节，不经 JSON），
/// 项目路径与文件名放在请求头中（百分号编码，头部只能是 ASCII）。
#[tauri::command]
pub async fn project_import_asset_data(request: tauri::ipc::Request<'_>) -> Result<String, StorageError> {
    let header = |name: &str| -> Result<String, StorageError> {
        let value = request
            .headers()
            .get(name)
            .and_then(|value| value.to_str().ok())
            .ok_or(StorageError::AssetUnsupported)?;
        percent_decode(value).ok_or(StorageError::AssetUnsupported)
    };
    let path = PathBuf::from(header("writer-project")?);
    let name = header("writer-file-name")?;
    let tauri::ipc::InvokeBody::Raw(bytes) = request.body() else {
        return Err(StorageError::AssetUnsupported);
    };
    let bytes = bytes.clone();
    run_storage(move || storage::assets::import_asset_bytes(&RealFs, &path, &name, &bytes)).await
}

/// encodeURIComponent 的逆运算；不是合法的 UTF-8 时为 None。
fn percent_decode(value: &str) -> Option<String> {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut index = 0;
    while index < bytes.len() {
        if bytes[index] == b'%' {
            let hex = std::str::from_utf8(bytes.get(index + 1..index + 3)?).ok()?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
            index += 3;
        } else {
            out.push(bytes[index]);
            index += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// 把磁盘上已提交的项目保存为一个版本（docs/project-format.md 第 7.1 节）。
#[tauri::command]
pub async fn snapshot_create(
    path: PathBuf,
    label: String,
    kind: storage::snapshots::SnapshotKind,
) -> Result<storage::snapshots::SnapshotInfo, StorageError> {
    let now = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis() as u64);
    run_storage(move || storage::snapshots::create_snapshot(&RealFs, &path, &label, kind, now)).await
}

#[tauri::command]
pub async fn snapshot_list(path: PathBuf) -> Result<Vec<storage::snapshots::SnapshotInfo>, StorageError> {
    run_storage(move || storage::snapshots::list_snapshots(&RealFs, &path)).await
}

#[tauri::command]
pub async fn snapshot_read(path: PathBuf, id: String) -> Result<storage::OpenedProject, StorageError> {
    run_storage(move || storage::snapshots::read_snapshot(&RealFs, &path, &id)).await
}

#[tauri::command]
pub async fn snapshot_delete(path: PathBuf, id: String) -> Result<(), StorageError> {
    run_storage(move || storage::snapshots::delete_snapshot(&RealFs, &path, &id)).await
}

/// 导出 Word：在后台线程生成，原子写入目标文件。
#[tauri::command]
pub async fn export_docx(
    path: PathBuf,
    document: RenderRequest,
    target: PathBuf,
) -> Result<ExportReport, ExportError> {
    tauri::async_runtime::spawn_blocking(move || {
        let (bytes, report) = export::docx::export(&render::build(&document), &path)?;
        export::write_output(&target, &bytes)?;
        Ok(report)
    })
    .await
    .map_err(|error| ExportError::RenderFailed {
        message: error.to_string(),
    })?
}

/// 在系统文件管理器中显示文件（导出完成后使用）。
#[tauri::command]
pub fn reveal_in_file_manager(path: PathBuf) -> Result<(), String> {
    use std::process::Command;
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg("-R").arg(&path).spawn();
    #[cfg(target_os = "windows")]
    let result = Command::new("explorer")
        .arg(format!("/select,{}", path.display()))
        .spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open")
        .arg(path.parent().unwrap_or(&path))
        .spawn();
    result.map(|_| ()).map_err(|error| error.to_string())
}

/// 导出 PDF：内嵌 Typst 排版，原子写入目标文件。
#[tauri::command]
pub async fn export_pdf(
    app: tauri::AppHandle,
    path: PathBuf,
    document: RenderRequest,
    layout: PdfLayout,
    target: PathBuf,
) -> Result<ExportReport, ExportError> {
    let resource_dir = app.path().resource_dir().ok();
    tauri::async_runtime::spawn_blocking(move || {
        let fonts = export::pdf::font_store(resource_dir.as_deref());
        let (bytes, report) = export::pdf::export(&render::build(&document), &path, fonts, &layout)?;
        export::write_output(&target, &bytes)?;
        Ok(report)
    })
    .await
    .map_err(|error| ExportError::RenderFailed {
        message: error.to_string(),
    })?
}

/// PDF 样张：按排版配置排版文档开头的一部分，返回前几页的 SVG。不写任何文件。
#[tauri::command]
pub async fn preview_pdf(
    app: tauri::AppHandle,
    path: PathBuf,
    document: RenderRequest,
    layout: PdfLayout,
) -> Result<Vec<String>, ExportError> {
    let resource_dir = app.path().resource_dir().ok();
    tauri::async_runtime::spawn_blocking(move || {
        let fonts = export::pdf::font_store(resource_dir.as_deref());
        export::pdf::preview(&render::build(&document), &path, fonts, &layout)
    })
    .await
    .map_err(|error| ExportError::RenderFailed {
        message: error.to_string(),
    })?
}

#[cfg(test)]
mod tests {
    use super::percent_decode;

    #[test]
    fn percent_decode_reverses_encode_uri_component() {
        assert_eq!(percent_decode("%2F%E6%96%87%E7%A8%BF%2Fa%20b.png").as_deref(), Some("/文稿/a b.png"));
        assert_eq!(percent_decode("plain").as_deref(), Some("plain"));
        assert_eq!(percent_decode("%E6%96"), None);
        assert_eq!(percent_decode("%zz"), None);
        assert_eq!(percent_decode("%4"), None);
    }
}
