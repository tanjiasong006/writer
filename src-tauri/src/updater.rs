//! 检查更新（直接分发的安装包，Tauri updater）。
//!
//! 更新地址与签名公钥在构建正式包时由环境变量提供（`WRITER_UPDATE_ENDPOINT`、`WRITER_UPDATE_PUBKEY`），
//! 没有提供的构建（开发版、自行编译）不检查更新，前端据此说明“此版本未配置自动更新”。
//! 发布流程见 docs/decisions.md 第 10 节。
//!
//! 国内直接访问 GitHub 常常失败，构建时可以用 `WRITER_UPDATE_MIRROR` 提供一个下载中转站的地址模板：
//! `{url}` 替换为原地址，`{encoded_url}` 替换为编码后的原地址（作为查询参数时使用）。
//! 检查（latest.json）与下载安装包都先经中转站，失败（网络、超时、内容无效、签名不符）再直接访问 GitHub。
//! 安装包总要用内置公钥校验签名，中转站无法替换安装包；更换中转站只需改模板重新发布，
//! 已安装的版本在旧中转站失效后回到 GitHub，更新后即使用新的中转站。
//!
//! 检查到的更新保存在应用状态中，安装时下载、校验签名并替换应用；重新启动由前端在保存文档后请求。

use std::sync::Mutex;
use std::time::Duration;

use serde::Serialize;
use tauri::{AppHandle, State};
use tauri_plugin_updater::{Update, UpdaterExt};

const ENDPOINT: Option<&str> = option_env!("WRITER_UPDATE_ENDPOINT");
const PUBKEY: Option<&str> = option_env!("WRITER_UPDATE_PUBKEY");
const MIRROR: Option<&str> = option_env!("WRITER_UPDATE_MIRROR");

/// 检查更新的每个地址最多等待的时间；超时后尝试下一个地址。
const CHECK_TIMEOUT: Duration = Duration::from_secs(15);
/// 经中转站下载安装包最多等待的时间；超时后直接从 GitHub 下载。直接下载不限时。
const MIRROR_DOWNLOAD_TIMEOUT: Duration = Duration::from_secs(10 * 60);

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
/// 依次尝试了几个地址时，每个地址的失败原因占一行。
#[derive(Serialize, Debug)]
pub struct UpdateError {
    message: String,
}

impl<E: std::error::Error> From<E> for UpdateError {
    fn from(error: E) -> Self {
        Self { message: describe(&error) }
    }
}

/// 错误连同其全部原因：网络错误的外层只有“error sending request”，DNS、连接、TLS 等真正的原因在内层。
fn describe(error: &dyn std::error::Error) -> String {
    let mut message = error.to_string();
    let mut source = error.source();
    while let Some(cause) = source {
        message.push_str(": ");
        message.push_str(&cause.to_string());
        source = cause.source();
    }
    message
}

/// 构建时配置的更新地址与公钥；任一缺失（或为空）时为 None。
fn configuration() -> Option<(&'static str, &'static str)> {
    match (ENDPOINT, PUBKEY) {
        (Some(endpoint), Some(pubkey)) if !endpoint.is_empty() && !pubkey.is_empty() => Some((endpoint, pubkey)),
        _ => None,
    }
}

/// 依次尝试的地址：先经中转站（构建时配置了模板时），再是原地址。
fn candidate_urls(url: &str, mirror: Option<&str>) -> Vec<String> {
    let mut urls = Vec::new();
    if let Some(template) = mirror.filter(|template| !template.is_empty()) {
        let encoded = percent_encoding::utf8_percent_encode(url, percent_encoding::NON_ALPHANUMERIC).to_string();
        urls.push(template.replace("{encoded_url}", &encoded).replace("{url}", url));
    }
    urls.push(url.to_owned());
    urls
}

#[tauri::command]
pub async fn update_check(app: AppHandle, pending: State<'_, PendingUpdate>) -> Result<UpdateCheck, UpdateError> {
    let Some((endpoint, pubkey)) = configuration() else {
        return Ok(UpdateCheck::NotConfigured);
    };
    let current = app.package_info().version.to_string();
    let mut update = None;
    let mut failures = Vec::new();
    for url in candidate_urls(endpoint, MIRROR) {
        let updater = app
            .updater_builder()
            .endpoints(vec![url.parse()?])?
            .pubkey(pubkey)
            .timeout(CHECK_TIMEOUT)
            .build()?;
        match updater.check().await {
            Ok(found) => {
                update = Some(found);
                break;
            }
            Err(error) => {
                let failure = describe(&error);
                log::warn!("update check via {url} failed: {failure}");
                failures.push(failure);
            }
        }
    }
    let Some(update) = update else {
        return Err(UpdateError { message: failures.join("\n") });
    };
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

/// 下载并安装最近一次检查到的更新（先经中转站，校验签名）；完成后需要重新启动才生效。
#[tauri::command]
pub async fn update_install(pending: State<'_, PendingUpdate>) -> Result<(), UpdateError> {
    let update = pending
        .0
        .lock()
        .unwrap_or_else(|poisoned| poisoned.into_inner())
        .take()
        .ok_or_else(|| UpdateError { message: "no pending update".to_owned() })?;
    let urls = candidate_urls(update.download_url.as_str(), MIRROR);
    let direct = urls.len() - 1;
    let mut failures = Vec::new();
    for (index, url) in urls.into_iter().enumerate() {
        let mut attempt = update.clone();
        attempt.download_url = url.parse()?;
        attempt.timeout = (index != direct).then_some(MIRROR_DOWNLOAD_TIMEOUT);
        match attempt.download(|_, _| {}, || {}).await {
            Ok(bytes) => {
                update.install(bytes)?;
                return Ok(());
            }
            Err(error) => {
                let failure = describe(&error);
                log::warn!("update download via {url} failed: {failure}");
                failures.push(failure);
            }
        }
    }
    Err(UpdateError { message: failures.join("\n") })
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

    #[test]
    fn describe_includes_every_cause() {
        let io = std::io::Error::new(std::io::ErrorKind::ConnectionRefused, "connection refused");
        let outer = std::io::Error::other(Wrapped(io));
        assert_eq!(describe(&outer), "error sending request: connection refused");
    }

    #[derive(Debug)]
    struct Wrapped(std::io::Error);

    impl std::fmt::Display for Wrapped {
        fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
            f.write_str("error sending request")
        }
    }

    impl std::error::Error for Wrapped {
        fn source(&self) -> Option<&(dyn std::error::Error + 'static)> {
            Some(&self.0)
        }
    }

    #[test]
    fn candidate_urls_try_mirror_before_original() {
        let url = "https://github.com/o/r/releases/download/v1.0.0/Writer 1.0.0.msi";
        assert_eq!(
            candidate_urls(url, Some("https://mirror.example/?url={encoded_url}")),
            vec![
                "https://mirror.example/?url=https%3A%2F%2Fgithub%2Ecom%2Fo%2Fr%2Freleases%2Fdownload%2Fv1%2E0%2E0%2FWriter%201%2E0%2E0%2Emsi"
                    .to_owned(),
                url.to_owned(),
            ]
        );
        assert_eq!(
            candidate_urls(url, Some("https://mirror.example/{url}")),
            vec![format!("https://mirror.example/{url}"), url.to_owned()]
        );
    }

    #[test]
    fn candidate_urls_without_mirror_is_original_only() {
        let url = "https://github.com/o/r/releases/download/updater/latest.json";
        assert_eq!(candidate_urls(url, None), vec![url.to_owned()]);
        assert_eq!(candidate_urls(url, Some("")), vec![url.to_owned()]);
    }
}
