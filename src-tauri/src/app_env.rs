//! 应用环境：开发版（Writer Dev）与正式版（Writer）是两个独立的应用。
//!
//! - 开发构建（debug）在运行时换成自己的 identifier 与名称（`com.writer.app.dev` / "Writer Dev"），
//!   Tauri 按 identifier 决定的应用数据、配置、缓存目录（以及 Windows 上 WebView2 的数据目录）因此与正式版分开。
//! - 应用级状态（上次打开的项目、侧栏宽度等本机偏好）保存在 identifier 对应的配置目录中的 `app-state.json`，
//!   不放在网页的 localStorage 里：两个环境各自只知道自己打开过的项目，开发版永远不会自动打开正式版上次的项目。
//! - 项目文件夹里的独占锁（`.writer/lock`）按项目路径加锁，与应用环境无关：开发版与正式版打开同一个真实项目时
//!   仍然互相阻止，保护文档不被两个进程同时写入。
//!
//! 开发构建还接受环境变量 `WRITER_OPEN_PROJECT`：启动时打开这个项目（自动化测试用，只应指向测试项目）。
//! 正式构建忽略它。

use std::fs;
use std::io::Write;
use std::path::{Path, PathBuf};

use serde::Serialize;

pub const DEVELOPMENT: bool = cfg!(debug_assertions);
pub const DEV_IDENTIFIER: &str = "com.writer.app.dev";
pub const DEV_PRODUCT_NAME: &str = "Writer Dev";
const STATE_FILE: &str = "app-state.json";
const STATE_TMP: &str = "app-state.json.tmp";
const OPEN_PROJECT_ENV: &str = "WRITER_OPEN_PROJECT";

/// 开发构建换成自己的应用身份；正式构建不变。必须在创建应用之前调用。
pub fn apply<R: tauri::Runtime>(context: &mut tauri::Context<R>) {
    if DEVELOPMENT {
        let config = context.config_mut();
        config.identifier = DEV_IDENTIFIER.into();
        config.product_name = Some(DEV_PRODUCT_NAME.into());
    }
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct AppStateSnapshot {
    /// "development" 或 "production"。
    pub environment: &'static str,
    /// 应用名称（"Writer" / "Writer Dev"），用于窗口标题与菜单。
    pub app_name: String,
    /// 保存的应用级状态（JSON 文本）；还没有保存过时为 None。
    pub state: Option<String>,
    /// 开发构建中 `WRITER_OPEN_PROJECT` 指定的项目；正式构建总是 None。
    pub open_project: Option<String>,
}

pub fn read_state(dir: &Path) -> Option<String> {
    fs::read(dir.join(STATE_FILE))
        .ok()
        .and_then(|bytes| String::from_utf8(bytes).ok())
}

/// 经临时文件原子替换写入。
pub fn write_state(dir: &Path, state: &str) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let tmp = dir.join(STATE_TMP);
    {
        let mut file = fs::File::create(&tmp)?;
        file.write_all(state.as_bytes())?;
        file.sync_all()?;
    }
    fs::rename(&tmp, dir.join(STATE_FILE))
}

pub fn snapshot(dir: &Path, app_name: String) -> AppStateSnapshot {
    AppStateSnapshot {
        environment: if DEVELOPMENT { "development" } else { "production" },
        app_name,
        state: read_state(dir),
        open_project: if DEVELOPMENT {
            std::env::var(OPEN_PROJECT_ENV).ok().filter(|path| !path.is_empty())
        } else {
            None
        },
    }
}

pub fn state_dir(app: &tauri::AppHandle) -> Result<PathBuf, String> {
    use tauri::Manager;
    app.path().app_config_dir().map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn state_round_trips_and_missing_state_is_none() {
        let dir = tempfile::tempdir().unwrap();
        let nested = dir.path().join("com.writer.app.dev");
        assert_eq!(read_state(&nested), None);
        write_state(&nested, r#"{"lastProjectPath":"/tmp/测试"}"#).unwrap();
        assert_eq!(read_state(&nested).as_deref(), Some(r#"{"lastProjectPath":"/tmp/测试"}"#));
        assert!(!nested.join(STATE_TMP).exists());
    }

    #[test]
    fn debug_builds_are_development() {
        // cargo test 是 debug 构建：开发环境。
        assert!(DEVELOPMENT);
        let dir = tempfile::tempdir().unwrap();
        assert_eq!(snapshot(dir.path(), "Writer Dev".into()).environment, "development");
    }
}
