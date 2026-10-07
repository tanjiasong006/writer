//! 错误日志：写入应用日志目录中的文件，正式版中也可用，用户从“帮助 → 显示日志文件夹”取出后发给开发者。
//!
//! - 目录由 identifier 决定（macOS `~/Library/Logs/<identifier>`，Windows `%LOCALAPPDATA%\<identifier>\logs`），
//!   开发版与正式版各自独立（见 app_env）。
//! - 前端的 console.error / console.warn 与未处理的异常经 `@tauri-apps/plugin-log` 写入同一文件（infrastructure/tauri_log.ts）。
//! - 只记录错误与必要的上下文，不记录正文内容。

use std::path::Path;

use tauri::Manager;
use tauri_plugin_log::{RotationStrategy, Target, TargetKind, TimezoneStrategy};

/// 单个日志文件的上限；超过后换新文件，保留最近几个。
const MAX_FILE_BYTES: u128 = 1_000_000;
const KEEP_FILES: usize = 3;

pub fn plugin<R: tauri::Runtime>() -> tauri::plugin::TauriPlugin<R> {
    tauri_plugin_log::Builder::new()
        .clear_targets()
        .target(Target::new(TargetKind::LogDir { file_name: None }))
        .target(Target::new(TargetKind::Stdout))
        .level(log::LevelFilter::Info)
        .max_file_size(MAX_FILE_BYTES)
        .rotation_strategy(RotationStrategy::KeepSome(KEEP_FILES))
        .timezone_strategy(TimezoneStrategy::UseLocal)
        .build()
}

/// 启动时记录版本与运行环境（WebView 的版本在各台电脑上可能不同），并把 panic 写入日志。
pub fn start(app: &tauri::App) {
    log::info!(
        "{} {} on {} {}, webview {}",
        app.package_info().name,
        app.package_info().version,
        std::env::consts::OS,
        std::env::consts::ARCH,
        tauri::webview_version().unwrap_or_else(|error| format!("unknown ({error})")),
    );
    let previous = std::panic::take_hook();
    std::panic::set_hook(Box::new(move |info| {
        log::error!("panic: {info}");
        previous(info);
    }));
}

/// 在系统文件管理器中打开日志文件夹（还没有日志时先创建）。
#[tauri::command]
pub fn reveal_log_folder(app: tauri::AppHandle) -> Result<(), String> {
    let dir = app.path().app_log_dir().map_err(|error| error.to_string())?;
    std::fs::create_dir_all(&dir).map_err(|error| error.to_string())?;
    open_folder(&dir).map_err(|error| error.to_string())
}

fn open_folder(dir: &Path) -> std::io::Result<()> {
    use std::process::Command;
    #[cfg(target_os = "macos")]
    let result = Command::new("open").arg(dir).spawn();
    #[cfg(target_os = "windows")]
    let result = Command::new("explorer").arg(dir).spawn();
    #[cfg(all(unix, not(target_os = "macos")))]
    let result = Command::new("xdg-open").arg(dir).spawn();
    result.map(|_| ())
}
