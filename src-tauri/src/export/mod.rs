//! Word / PDF 导出。两者都从 `render::Document` 生成，保证与预览结构一致。
//!
//! 通用约定：
//! - 输出文件先写到同目录临时文件，完整写入并 fsync 后再 rename，失败时不会留下半个文件，
//!   也不会破坏同名的旧文件。
//! - 用户数据（图片等）中的任何问题都不能让导出崩溃：图片无法读取时输出占位文字并计入报告。

pub mod docx;
pub mod fonts;
pub mod images;

use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

use serde::Serialize;

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "kebab-case")]
pub enum ExportError {
    /// 系统中找不到能显示中文的字体（PDF 导出）。
    NoCjkFont,
    Io {
        message: String,
    },
    RenderFailed {
        message: String,
    },
}

/// 导出完成后的报告：可恢复的问题，前端据此提示用户。
#[derive(Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    /// 无法嵌入的图片引用（缺失、越出项目、格式损坏）。
    pub missing_images: Vec<String>,
}

/// 原子写出导出文件：临时文件 → fsync → rename。
pub fn write_output(target: &Path, bytes: &[u8]) -> Result<(), ExportError> {
    let io = |error: std::io::Error| ExportError::Io {
        message: error.to_string(),
    };
    let dir = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let name = target.file_name().ok_or_else(|| ExportError::Io {
        message: "invalid target path".into(),
    })?;
    let tmp = dir.join(format!(".{}.writer-tmp", name.to_string_lossy()));
    let result = (|| {
        let mut file = File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&tmp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(io)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn write_output_replaces_atomically_and_cleans_up() {
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("论文 终稿.docx");
        fs::write(&target, b"old").unwrap();
        write_output(&target, b"new").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);

        let missing_dir = dir.path().join("不存在/论文.docx");
        assert!(matches!(
            write_output(&missing_dir, b"x"),
            Err(ExportError::Io { .. })
        ));
    }
}
