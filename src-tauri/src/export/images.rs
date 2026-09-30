//! 导出用图片：统一的显示尺寸规则与图片加载。图片来自用户项目，可能缺失、损坏或是"解压炸弹"，
//! 加载时一律返回 None 而不是 panic。

use std::io::Cursor;
use std::path::Path;

use image::{ImageFormat, ImageReader, Limits};

/// 单边像素上限；更大的图片按比例缩小后再嵌入 Word，控制文件体积。
const MAX_EMBED_PX: u32 = 2400;
/// 解码时的尺寸与内存上限，防止恶意图片耗尽内存。
const MAX_DECODE_PX: u32 = 20_000;
const MAX_DECODE_BYTES: u64 = 512 * 1024 * 1024;

/// 图片固有尺寸按 96 DPI 换算：1 像素 = 0.75 磅（Word 与 PDF 一致）。
/// 图像元数据中的 DPI 如何解释尚未确定（docs/decisions.md 第 8 节"图片自动尺寸约束"），确定前不读取它。
const PT_PER_PX: f64 = 0.75;

/// 图片可以占用的区域（磅）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bounds {
    pub width: f64,
    pub height: f64,
}

/// 图片的显示尺寸（磅）：保持比例，不放大；宽不超过 bounds.width，高不超过 bounds.height。
/// 输出统一规则（docs/decisions.md 第 8 节），不存在单张图片的尺寸设置。
pub fn display_size_pt(width_px: u32, height_px: u32, bounds: Bounds) -> (f64, f64) {
    let width = f64::from(width_px) * PT_PER_PX;
    let height = f64::from(height_px) * PT_PER_PX;
    let scale = 1.0_f64
        .min(bounds.width.max(1.0) / width)
        .min(bounds.height.max(1.0) / height);
    (width * scale, height * scale)
}

/// 图注在页面上占用的高度估计（磅），用于从正文区高度中为图注预留空间。
/// 按可用宽度估计折行：全角字符按 1em、其他字符按 0.6em 计，宁可多估也不让图注被挤出页面。
pub fn caption_height_pt(caption: &str, font_size: f64, line_pitch: f64, width: f64) -> f64 {
    let ems: f64 = caption
        .chars()
        .map(|c| if c.is_ascii() { 0.6 } else { 1.0 })
        .sum();
    let lines = (ems * font_size / width.max(1.0)).ceil().max(1.0);
    lines * line_pitch
}

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

    const PAGE: Bounds = Bounds {
        width: 453.5,
        height: 700.0,
    };

    #[test]
    fn small_images_are_not_enlarged() {
        assert_eq!(display_size_pt(100, 50, PAGE), (75.0, 37.5));
    }

    #[test]
    fn wide_images_shrink_to_the_available_width() {
        let (w, h) = display_size_pt(3000, 300, PAGE);
        assert!((w - 453.5).abs() < 1e-6 && (h - 45.35).abs() < 1e-6);
    }

    #[test]
    fn tall_images_are_limited_by_the_available_height_keeping_ratio() {
        let (w, h) = display_size_pt(400, 1600, PAGE);
        assert!((h - 700.0).abs() < 1e-6);
        assert!((w / h - 0.25).abs() < 1e-9);
        // 为图注预留空间后高度相应减少，比例不变。
        let (w, h) = display_size_pt(400, 1600, Bounds { height: 650.0, ..PAGE });
        assert!((h - 650.0).abs() < 1e-6 && (w / h - 0.25).abs() < 1e-9);
    }

    #[test]
    fn narrow_containers_limit_the_width() {
        // 表格单元格等较窄的容器：按容器宽度缩小，保持比例，不按文字行高压成小图。
        let (w, h) = display_size_pt(800, 400, Bounds { width: 100.0, ..PAGE });
        assert!((w - 100.0).abs() < 1e-6 && (h - 50.0).abs() < 1e-6);
    }

    #[test]
    fn caption_height_grows_with_wrapped_lines() {
        assert_eq!(caption_height_pt("图 1", 10.0, 18.0, 400.0), 18.0);
        let long = "很长的图注".repeat(20); // 100 个全角字符 × 10 磅 = 1000 磅 → 3 行
        assert_eq!(caption_height_pt(&long, 10.0, 18.0, 400.0), 54.0);
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
