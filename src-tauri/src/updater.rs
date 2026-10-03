//! 检查更新（直接分发的安装包，Tauri updater）。
//!
//! 更新地址与签名公钥在构建正式包时由环境变量提供（`WRITER_UPDATE_ENDPOINT`、`WRITER_UPDATE_PUBKEY`），
//! 没有提供的构建（开发版、自行编译）不检查更新，前端据此说明“此版本未配置自动更新”。
//! 发布流程见 docs/decisions.md 第 10 节。
//!
//! 检查到的更新保存在应用状态中，安装时下载、校验签名并替换应用；重新启动由前端在保存文档后请求。

use std::sync::Mutex;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const ENDPOINT: Option<&str> = option_env!("WRITER_UPDATE_ENDPOINT");
const PUBKEY: Option<&str> = option_env!("WRITER_UPDATE_PUBKEY");

#[derive(Default)]
pub struct PendingUpdate(Mutex<Option<Update>>);

/// 检查结果。
#[derive(Serialize, Debug, PartialEq)]
#[serde(tag = "kind", rename_all = "kebab-case")]
pub enum UpdateCheck {
    /// 此构建没有配置更新地址与公钥。
    NotConfigured,
    UpToDate { current: String },
    Available { current: String, version: String, notes: Option<String> },
}

/// 检查失败的原因（网络、服务器返回的内容等），只用于界面上说明。
#[derive(Serialize, Debug)]
pub struct UpdateError {
    message: String,
}

impl<E: std::fmt::Display> From<E> for UpdateError {
    fn from(error: E) -> Self {
        Self { message: error.to_string() }
    }
}

/// 构建时配置的更新地址与公钥；任一缺失（或为空）时为 None。
fn configuration() -> Option<(&'static str, &'static str)> {
    match (ENDPOINT, PUBKEY) {
        (Some(endpoint), Some(pubkey)) if !endpoint.is_empty() && !pubkey.is_empty() => Some((endpoint, pubkey)),
        _ => None,
    }
}

#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<UpdateCheck, UpdateError> {
    let Some((endpoint, pubkey)) = configuration() else {
        return Ok(UpdateCheck::NotConfigured);
    };
    let current = app.package_info().version.to_string();
    let updater = app
        .updater_builder()
        .endpoints(vec![endpoint.parse()?])?
        .pubkey(pubkey)
        .build()?;
    let update = updater.check().await?;
    let result = match &update {
        Some(update) => UpdateCheck::Available {
            current,
            version: update.version.clone(),
            notes: update.body.clone().filter(|notes| !notes.trim().is_empty()),
        },
        None => UpdateCheck::UpToDate { current },
    };
    *pending.0.lock().unwrap_or_else(|poisoned| poisoned.into_inner()) = update;
    Ok(result)
}

/// 下载并安装最近一次检查到的更新（校验签名）；完成后需要重新启动才生效。
#[tauri::command]
pub async fn update_install(pending: State<'_, PendingUpdate>) -> Result<(), UpdateError> {
    let update = pending
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take()
        .ok_or_else(|| UpdateError { message: "no pending update".to_owned() })?;
    update.download_and_install(|_, _| {}, || {}).await?;
    Ok(())
}

/// 重新启动应用（安装更新之后）。前端在调用前已保存并释放项目。
#[tauri::command]
pub fn app_restart(app: AppHandle) {
    app.restart();
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn check_result_serializes_with_kind() {
        let available = UpdateCheck::Available { current: "0.1.0".into(), version: "0.2.0".into(), notes: None };
        assert_eq!(
            serde_json::to_value(available).unwrap(),
            serde_json::json!({ "kind": "available", "current": "0.1.0", "version": "0.2.0", "notes": null })
        );
        assert_eq!(
            serde_json::to_value(UpdateCheck::NotConfigured).unwrap(),
            serde_json::json!({ "kind": "not-configured" })
        );
    }
}
