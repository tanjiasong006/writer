//! 导出用图片加载。图片来自用户项目，可能缺失、损坏或是"解压炸弹"，
//! 这里一律返回 None 而不是 panic（release 构建 panic = abort，会直接让应用退出）。

use std::io::Cursor;
use std::path::Path;

use image::{ImageFormat, ImageReader, Limits};

/// 单边像素上限；更大的图片按比例缩小后再嵌入 Word，控制文件体积。
const MAX_EMBED_PX: u32 = 2400;
/// 解码时的尺寸与内存上限，防止恶意图片耗尽内存。
const MAX_DECODE_PX: u32 = 20_000;
const MAX_DECODE_BYTES: u64 = 512 * 1024 * 1024;

pub struct DocxImage {
    /// PNG 字节（docx-rs 以 png 形式存放媒体）。
    pub png: Vec<u8>,
    pub width: u32,
    pub height: u32,
}

fn limits() -> Limits {
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DECODE_PX);
    limits.max_image_height = Some(MAX_DECODE_PX);
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    limits
}

/// 读取并准备嵌入 Word 的图片：PNG 且尺寸合适时原样使用，否则解码、必要时缩小、转为 PNG。
pub fn load_for_docx(path: &Path) -> Option<DocxImage> {
    let bytes = std::fs::read(path).ok()?;
    let mut reader = ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .ok()?;
    reader.limits(limits());
    let format = reader.format()?;
    let (width, height) = reader.into_dimensions().ok()?;
    if width == 0 || height == 0 {
        return None;
    }
    if format == ImageFormat::Png && width <= MAX_EMBED_PX && height <= MAX_EMBED_PX {
        // 尺寸可读不代表内容完整：完整解码一次，确认不是损坏文件。
        decode(&bytes)?;
        return Some(DocxImage {
            png: bytes,
            width,
            height,
        });
    }
    let mut image = decode(&bytes)?;
    if width > MAX_EMBED_PX || height > MAX_EMBED_PX {
        image = image.thumbnail(MAX_EMBED_PX, MAX_EMBED_PX);
    }
    let mut png = Cursor::new(Vec::new());
    image.write_to(&mut png, ImageFormat::Png).ok()?;
    Some(DocxImage {
        png: png.into_inner(),
        width: image.width(),
        height: image.height(),
    })
}

fn decode(bytes: &[u8]) -> Option<image::DynamicImage> {
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .ok()?;
    reader.limits(limits());
    reader.decode().ok()
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use image::{Rgb, RgbImage};
    use std::fs;
    use tempfile::TempDir;

    /// 生成一张指定尺寸与格式的测试图片。
    pub fn write_image(path: &Path, width: u32, height: u32, format: ImageFormat) {
        let image = RgbImage::from_fn(width, height, |x, y| {
            Rgb([(x % 256) as u8, (y % 256) as u8, 128])
        });
        image.save_with_format(path, format).unwrap();
    }

    #[test]
    fn png_is_used_as_is() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("图.png");
        write_image(&path, 40, 20, ImageFormat::Png);
        let image = load_for_docx(&path).unwrap();
        assert_eq!((image.width, image.height), (40, 20));
        assert_eq!(image.png, fs::read(&path).unwrap());
    }

    #[test]
    fn jpeg_and_gif_are_converted_to_png() {
        let dir = TempDir::new().unwrap();
        for (name, format) in [("a.jpg", ImageFormat::Jpeg), ("a.gif", ImageFormat::Gif)] {
            let path = dir.path().join(name);
            write_image(&path, 30, 10, format);
            let image = load_for_docx(&path).unwrap();
            assert_eq!((image.width, image.height), (30, 10));
            assert!(image.png.starts_with(&[137, 80, 78, 71]));
        }
    }

    #[test]
    fn large_images_are_scaled_down() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("大.png");
        write_image(&path, 4800, 600, ImageFormat::Png);
        let image = load_for_docx(&path).unwrap();
        assert_eq!((image.width, image.height), (2400, 300));
    }

    #[test]
    fn broken_or_missing_images_return_none() {
        let dir = TempDir::new().unwrap();
        let broken = dir.path().join("坏.png");
        fs::write(&broken, b"\x89PNG\r\n\x1a\nnot really").unwrap();
        assert!(load_for_docx(&broken).is_none());
        let text = dir.path().join("文本.png");
        fs::write(&text, "这不是图片").unwrap();
        assert!(load_for_docx(&text).is_none());
        assert!(load_for_docx(&dir.path().join("无.png")).is_none());
    }

    #[test]
    fn truncated_png_is_rejected() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("截断.png");
        write_image(&path, 50, 50, ImageFormat::Png);
        let bytes = fs::read(&path).unwrap();
        fs::write(&path, &bytes[..bytes.len() / 2]).unwrap();
        assert!(load_for_docx(&path).is_none());
    }
}
