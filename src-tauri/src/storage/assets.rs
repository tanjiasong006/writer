//! 资源导入：把用户选择的图片复制进项目的 assets/，返回项目内文件名。
//!
//! - 只接受 Word 与 PDF 导出都能直接嵌入的格式（png / jpg / jpeg / gif）。
//! - 文件名清洗为只含字母数字（含中文）、`-`、`_`，这样 Markdown 链接无需转义。
//! - 同名且内容相同直接复用；同名不同内容加 `-1`、`-2` 后缀，绝不覆盖已有资源。
//! - 先写临时文件再 rename，assets/ 中不会出现写了一半的图片。

use std::io;
use std::path::Path;

use super::fs::Fs;
use super::{io_error, Paths, Result, StorageError};

pub const ASSETS_DIR: &str = "assets";
pub const SUPPORTED_EXTENSIONS: [&str; 4] = ["png", "jpg", "jpeg", "gif"];
const MAX_ASSET_BYTES: usize = 50 * 1024 * 1024;
const MAX_STEM_CHARS: usize = 60;
const ASSET_TMP: &str = "asset.tmp";

pub fn import_asset(fs: &dyn Fs, root: &Path, source: &Path) -> Result<String> {
    let paths = Paths::new(root);
    if !fs.exists(&paths.manifest) {
        return Err(StorageError::NotAProject);
    }
    let extension = supported_extension(source).ok_or(StorageError::AssetUnsupported)?;
    let bytes = fs.read(source).map_err(|error| match error.kind() {
        io::ErrorKind::NotFound => StorageError::AssetNotFound,
        _ => io_error("read", source)(error),
    })?;
    let stem = source.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    write_asset(fs, root, stem, &extension, &bytes)
}

/// 导入粘贴或拖入的图片数据（没有源文件路径）：file_name 只用来取文件名与扩展名。
/// 格式按文件内容判断（剪贴板中的图片名称常常不可靠），只接受与 import_asset 相同的格式。
pub fn import_asset_bytes(fs: &dyn Fs, root: &Path, file_name: &str, bytes: &[u8]) -> Result<String> {
    let paths = Paths::new(root);
    if !fs.exists(&paths.manifest) {
        return Err(StorageError::NotAProject);
    }
    let extension = sniff_extension(bytes).ok_or(StorageError::AssetUnsupported)?;
    let name = Path::new(file_name);
    // 名称中的扩展名与内容一致时保留原写法（jpeg / jpg），否则用内容对应的扩展名。
    let extension = supported_extension(name)
        .filter(|named| same_format(named, extension))
        .unwrap_or_else(|| extension.to_owned());
    let stem = name.file_stem().and_then(|s| s.to_str()).unwrap_or("");
    write_asset(fs, root, stem, &extension, bytes)
}

fn supported_extension(path: &Path) -> Option<String> {
    path.extension()
        .and_then(|e| e.to_str())
        .map(str::to_ascii_lowercase)
        .filter(|e| SUPPORTED_EXTENSIONS.contains(&e.as_str()))
}

/// 按文件头判断图片格式。
fn sniff_extension(bytes: &[u8]) -> Option<&'static str> {
    if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("png")
    } else if bytes.starts_with(&[0xff, 0xd8, 0xff]) {
        Some("jpg")
    } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
        Some("gif")
    } else {
        None
    }
}

fn same_format(a: &str, b: &str) -> bool {
    let normalize = |e: &str| if e == "jpeg" { "jpg".to_owned() } else { e.to_owned() };
    normalize(a) == normalize(b)
}

fn write_asset(fs: &dyn Fs, root: &Path, stem: &str, extension: &str, bytes: &[u8]) -> Result<String> {
    let paths = Paths::new(root);
    if bytes.len() > MAX_ASSET_BYTES {
        return Err(StorageError::AssetTooLarge);
    }

    let stem = sanitize_stem(stem);
    let assets = root.join(ASSETS_DIR);
    fs.create_dir_all(&assets)
        .map_err(io_error("create-dir", &assets))?;

    for attempt in 0.. {
        let name = if attempt == 0 {
            format!("{stem}.{extension}")
        } else {
            format!("{stem}-{attempt}.{extension}")
        };
        let target = assets.join(&name);
        if fs.exists(&target) {
            if fs.read(&target).is_ok_and(|existing| existing == bytes) {
                return Ok(name);
            }
            continue;
        }
        fs.create_dir_all(&paths.internal)
            .map_err(io_error("create-dir", &paths.internal))?;
        let tmp = paths.internal.join(ASSET_TMP);
        fs.write_synced(&tmp, bytes)
            .map_err(io_error("write", &tmp))?;
        fs.rename(&tmp, &target)
            .map_err(io_error("rename", &target))?;
        fs.sync_dir(&assets).map_err(io_error("sync", &assets))?;
        return Ok(name);
    }
    unreachable!("the loop only exits by returning")
}

/// 只保留字母数字（含中文等 Unicode 字母）、`-`、`_`，其余替换为 `-`；为空时用 image。
fn sanitize_stem(stem: &str) -> String {
    let mut result = String::new();
    for c in stem.chars() {
        let keep = c.is_alphanumeric() || c == '-' || c == '_';
        let c = if keep { c } else { '-' };
        if c == '-' && result.ends_with('-') {
            continue;
        }
        result.push(c);
    }
    let trimmed: String = result
        .trim_matches('-')
        .chars()
        .take(MAX_STEM_CHARS)
        .collect();
    let trimmed = trimmed.trim_end_matches('-');
    if trimmed.is_empty() {
        "image".to_owned()
    } else {
        trimmed.to_owned()
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::storage::fs::RealFs;
    use std::fs;
    use tempfile::TempDir;

    fn project(dir: &TempDir) -> std::path::PathBuf {
        let root = dir.path().join("项目");
        fs::create_dir_all(&root).unwrap();
        fs::write(root.join("writer.json"), "{}").unwrap();
        root
    }

    fn source(dir: &TempDir, name: &str, bytes: &[u8]) -> std::path::PathBuf {
        let path = dir.path().join(name);
        fs::write(&path, bytes).unwrap();
        path
    }

    const PNG: &[u8] = b"\x89PNG\r\n\x1a\nrest";

    #[test]
    fn imports_pasted_bytes_by_content() {
        let dir = TempDir::new().unwrap();
        let root = project(&dir);
        // 名称的扩展名与内容不符时按内容。
        assert_eq!(import_asset_bytes(&RealFs, &root, "截屏 2026.jpeg", PNG).unwrap(), "截屏-2026.png");
        assert_eq!(fs::read(root.join("assets/截屏-2026.png")).unwrap(), PNG);
        // 相同内容复用，没有名称时叫 image。
        assert_eq!(import_asset_bytes(&RealFs, &root, "截屏 2026.png", PNG).unwrap(), "截屏-2026.png");
        assert_eq!(import_asset_bytes(&RealFs, &root, "", &[0xff, 0xd8, 0xff, 0]).unwrap(), "image.jpg");
        assert_eq!(import_asset_bytes(&RealFs, &root, "a.JPEG", &[0xff, 0xd8, 0xff, 1]).unwrap(), "a.jpeg");
        assert!(matches!(
            import_asset_bytes(&RealFs, &root, "a.webp", b"RIFF....WEBP"),
            Err(StorageError::AssetUnsupported)
        ));
        let missing = dir.path().join("不是项目");
        fs::create_dir_all(&missing).unwrap();
        assert!(matches!(import_asset_bytes(&RealFs, &missing, "a.png", PNG), Err(StorageError::NotAProject)));
    }

    #[test]
    fn copies_image_into_assets() {
        let dir = TempDir::new().unwrap();
        let root = project(&dir);
        let src = source(&dir, "实验 装置(1).PNG", b"png-bytes");
        let name = import_asset(&RealFs, &root, &src).unwrap();
        assert_eq!(name, "实验-装置-1.png");
        assert_eq!(
            fs::read(root.join("assets").join(&name)).unwrap(),
            b"png-bytes"
        );
        assert!(!root.join(".writer/asset.tmp").exists());
    }

    #[test]
    fn identical_file_is_reused_and_different_file_gets_suffix() {
        let dir = TempDir::new().unwrap();
        let root = project(&dir);
        let a = source(&dir, "图.png", b"A");
        assert_eq!(import_asset(&RealFs, &root, &a).unwrap(), "图.png");
        assert_eq!(import_asset(&RealFs, &root, &a).unwrap(), "图.png");

        let other = dir.path().join("other");
        fs::create_dir_all(&other).unwrap();
        let b = other.join("图.png");
        fs::write(&b, b"B").unwrap();
        assert_eq!(import_asset(&RealFs, &root, &b).unwrap(), "图-1.png");
        assert_eq!(fs::read(root.join("assets/图.png")).unwrap(), b"A");
        assert_eq!(fs::read(root.join("assets/图-1.png")).unwrap(), b"B");
    }

    #[test]
    fn rejects_unsupported_missing_and_non_project() {
        let dir = TempDir::new().unwrap();
        let root = project(&dir);
        let svg = source(&dir, "a.svg", b"<svg/>");
        assert_eq!(
            import_asset(&RealFs, &root, &svg),
            Err(StorageError::AssetUnsupported)
        );
        let none = source(&dir, "noext", b"x");
        assert_eq!(
            import_asset(&RealFs, &root, &none),
            Err(StorageError::AssetUnsupported)
        );
        assert_eq!(
            import_asset(&RealFs, &root, &dir.path().join("missing.png")),
            Err(StorageError::AssetNotFound)
        );
        let png = source(&dir, "a.png", b"x");
        assert_eq!(
            import_asset(&RealFs, &dir.path().join("不是项目"), &png),
            Err(StorageError::NotAProject)
        );
    }

    #[test]
    fn sanitizes_names() {
        assert_eq!(sanitize_stem("hello world"), "hello-world");
        assert_eq!(sanitize_stem("../../etc/passwd"), "etc-passwd");
        assert_eq!(sanitize_stem("[图]"), "图");
        assert_eq!(sanitize_stem("..."), "image");
        assert_eq!(sanitize_stem(""), "image");
        assert_eq!(
            sanitize_stem(&"长".repeat(100)).chars().count(),
            MAX_STEM_CHARS
        );
    }
}
