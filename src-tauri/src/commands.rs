//! 暴露给前端的 Tauri command。只做参数转换与线程调度，业务规则在各模块内。

use std::path::{Path, PathBuf};
use std::sync::Mutex;

use tauri::Manager;

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
pub async fn project_create(path: PathBuf, request: SaveRequest) -> Result<(), StorageError> {
    run_storage(move || {
        storage::create_project(&RealFs, &path, &request)?;
        let lock = lock_project(&path)?;
        hold_lock(path, lock);
        Ok(())
    })
    .await
}

#[tauri::command]
pub async fn project_open(path: PathBuf) -> Result<OpenedProject, StorageError> {
    run_storage(move || {
        let lock = lock_project(&path)?;
        let opened = storage::open_project(&RealFs, &path)?;
        hold_lock(path, lock);
        Ok(opened)
    })
    .await
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

/// 全文预览 HTML。图片以本地路径给出，这里把项目目录加入 asset 协议的允许范围供 webview 读取。
#[tauri::command]
pub async fn render_preview(
    app: tauri::AppHandle,
    path: PathBuf,
    document: RenderRequest,
) -> Result<String, String> {
    let _ = app.asset_protocol_scope().allow_directory(&path, true);
    tauri::async_runtime::spawn_blocking(move || {
        render::html::render(&render::build(&document), &path)
    })
    .await
    .map_err(|error| error.to_string())
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
    target: PathBuf,
) -> Result<ExportReport, ExportError> {
    let resource_dir = app.path().resource_dir().ok();
    tauri::async_runtime::spawn_blocking(move || {
        let fonts = export::pdf::font_store(resource_dir.as_deref());
        let (bytes, report) = export::pdf::export(&render::build(&document), &path, fonts)?;
        export::write_output(&target, &bytes)?;
        Ok(report)
    })
    .await
    .map_err(|error| ExportError::RenderFailed {
        message: error.to_string(),
    })?
}
