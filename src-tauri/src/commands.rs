//! 暴露给前端的 Tauri command。只做参数转换与线程调度，业务规则在各模块内。

use std::path::PathBuf;
use std::sync::Mutex;

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
            message: error.to_string(),
        })
    })
}

#[tauri::command]
pub async fn project_create(path: PathBuf, request: SaveRequest) -> Result<(), StorageError> {
    run_storage(move || storage::create_project(&RealFs, &path, &request)).await
}

#[tauri::command]
pub async fn project_open(path: PathBuf) -> Result<OpenedProject, StorageError> {
    run_storage(move || storage::open_project(&RealFs, &path)).await
}

#[tauri::command]
pub async fn project_save(path: PathBuf, request: SaveRequest) -> Result<(), StorageError> {
    run_storage(move || storage::save_project(&RealFs, &path, &request)).await
}
