//! 导出用图片：统一的显示尺寸规则与图片加载。图片来自用户项目，可能缺失、损坏或是"解压炸弹"，
//! 加载时一律返回 None 而不是 panic。

use std::io::Cursor;
use std::path::Path;

use image::{ImageDecoder, ImageFormat, ImageReader, Limits};

/// 单边像素上限；更大的图片按比例缩小后再嵌入输出，控制文件体积。
const MAX_EMBED_PX: u32 = 2400;
/// 解码时的尺寸与内存上限，防止恶意图片耗尽内存。
const MAX_DECODE_PX: u32 = 20_000;
const MAX_DECODE_BYTES: u64 = 512 * 1024 * 1024;

/// 图片固有尺寸的 DPI 规则（docs/decisions.md 第 8 节"图片自动尺寸约束"）：PNG（pHYs，单位为米）与
/// JPEG（JFIF）元数据中的 DPI 在此范围内且横纵相同时按其换算，缺失或异常时按 96 DPI。
const DPI_RANGE: std::ops::RangeInclusive<f64> = 72.0..=600.0;
const DEFAULT_DPI: f64 = 96.0;

/// 图片可以占用的区域（磅）。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Bounds {
    pub width: f64,
    pub height: f64,
}

/// 图片的显示尺寸（磅）：从固有尺寸（`ExportImage::size_pt`）出发，保持比例，不放大；
/// 宽不超过 bounds.width，高不超过 bounds.height。
/// 输出统一规则（docs/decisions.md 第 8 节），不存在单张图片的尺寸设置。
pub fn display_size_pt((width, height): (f64, f64), bounds: Bounds) -> (f64, f64) {
    let scale = 1.0_f64
        .min(bounds.width.max(1.0) / width)
        .min(bounds.height.max(1.0) / height);
    (width * scale, height * scale)
}

/// 一段文字排版后占用的高度上限（磅），用于在无法测量排版结果的输出（Word）中预留空间。
/// 按贪心折行模拟：每个字符（含空格）都按 1em 计（常见字体中没有更宽的字形），
/// 连续的非空白、非中文字符是不可拆开的单词，中文逐字可断，超过一行宽的单词按字符拆开。
/// 宁可多估：预留的空间偏大只会让图片略小，不会让文字被挤出页面。
pub fn text_height_pt(text: &str, font_size: f64, line_pitch: f64, width: f64) -> f64 {
    let per_line = (width / font_size).floor().max(1.0) as usize;
    let mut lines = 1;
    let mut used = 0; // 当前行已占用的 em
    let mut word = 0; // 正在累积的单词长度（em）
    let place_word = |word: usize, used: &mut usize, lines: &mut usize| {
        if word == 0 {
            return;
        }
        if *used + word > per_line && *used > 0 {
            *lines += 1;
            *used = 0;
        }
        *used += word;
        while *used > per_line {
            *lines += 1;
            *used -= per_line;
        }
    };
    for c in text.chars() {
        if c.is_whitespace() || !c.is_ascii() {
            place_word(word, &mut used, &mut lines);
            word = 0;
            place_word(1, &mut used, &mut lines);
        } else {
            word += 1;
        }
    }
    place_word(word, &mut used, &mut lines);
    lines as f64 * line_pitch
}

pub struct ExportImage {
    /// JPEG 保留原压缩；其他格式使用 PNG。
    pub bytes: Vec<u8>,
    pub width: u32,
    pub height: u32,
    /// 固有尺寸（磅）：按原图像素与 DPI 换算，缩小嵌入不改变它；比例与嵌入的像素一致。
    pub size_pt: (f64, f64),
}

/// 原图元数据中的 DPI；缺失、超出范围或横纵不同时按 96。
fn image_dpi(bytes: &[u8]) -> f64 {
    let dpi = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
        png_dpi(bytes)
    } else if bytes.starts_with(&[0xff, 0xd8]) {
        jfif_dpi(bytes)
    } else {
        None
    };
    match dpi {
        Some((x, y)) if x == y && DPI_RANGE.contains(&x) => x,
        _ => DEFAULT_DPI,
    }
}

/// PNG 的 pHYs：在 IDAT 之前；单位不是米（只表示像素比例）时没有 DPI。
fn png_dpi(bytes: &[u8]) -> Option<(f64, f64)> {
    let mut at = 8;
    while at + 8 <= bytes.len() {
        let len = u32::from_be_bytes(bytes[at..at + 4].try_into().ok()?) as usize;
        let kind = &bytes[at + 4..at + 8];
        let data = bytes.get(at + 8..(at + 8).checked_add(len)?)?;
        match kind {
            b"pHYs" if len == 9 => {
                if data[8] != 1 {
                    return None;
                }
                let per_meter = |b: &[u8]| f64::from(u32::from_be_bytes(b.try_into().unwrap())) * 0.0254;
                return Some((per_meter(&data[0..4]), per_meter(&data[4..8])));
            }
            b"IDAT" | b"IEND" => return None,
            _ => at += 12 + len,
        }
    }
    None
}

/// JPEG 的 JFIF（APP0）密度：单位 1 为每英寸、2 为每厘米，0 只表示像素比例。不读取 Exif 中的分辨率。
fn jfif_dpi(bytes: &[u8]) -> Option<(f64, f64)> {
    let mut at = 2;
    while at + 4 <= bytes.len() && bytes[at] == 0xff {
        let marker = bytes[at + 1];
        if marker == 0xda || marker == 0xd9 {
            return None;
        }
        let len = usize::from(u16::from_be_bytes([bytes[at + 2], bytes[at + 3]]));
        let data = bytes.get(at + 4..(at + 2).checked_add(len)?)?;
        if marker == 0xe0 && data.len() >= 12 && data.starts_with(b"JFIF\0") {
            let x = f64::from(u16::from_be_bytes([data[8], data[9]]));
            let y = f64::from(u16::from_be_bytes([data[10], data[11]]));
            return match data[7] {
                1 => Some((x, y)),
                2 => Some((x * 2.54, y * 2.54)),
                _ => None,
            };
        }
        at += 2 + len;
    }
    None
}

fn size_pt(width: u32, height: u32, dpi: f64) -> (f64, f64) {
    let pt_per_px = 72.0 / dpi;
    (f64::from(width) * pt_per_px, f64::from(height) * pt_per_px)
}

/// 缩小后的图片：长边保持原图的物理长度，比例按缩小后的像素（取整可能改变极窄图的比例，
/// 输出按嵌入的像素计算高度）。
fn scaled_size_pt(original: (u32, u32), scaled: (u32, u32), dpi: f64) -> (f64, f64) {
    let long = |(w, h): (u32, u32)| f64::from(w.max(h));
    size_pt(scaled.0, scaled.1, dpi * long(scaled) / long(original))
}

fn limits() -> Limits {
    let mut limits = Limits::default();
    limits.max_image_width = Some(MAX_DECODE_PX);
    limits.max_image_height = Some(MAX_DECODE_PX);
    limits.max_alloc = Some(MAX_DECODE_BYTES);
    limits
}

/// Word / PDF 共用的图片准备：保留 JPEG 压缩，超大图仍沿用尺寸上限。
/// 带旋转元数据的 JPEG 沿用原 PNG 路径，保持现有显示方向与尺寸。
pub fn load_for_export(path: &Path) -> Option<ExportImage> {
    let bytes = std::fs::read(path).ok()?;
    let dpi = image_dpi(&bytes);
    let mut reader = ImageReader::new(Cursor::new(&bytes))
        .with_guessed_format()
        .ok()?;
    reader.limits(limits());
    if reader.format()? == ImageFormat::Jpeg {
        let mut decoder = reader.into_decoder().ok()?;
        let orientation = decoder.orientation().ok()?;
        let image = image::DynamicImage::from_decoder(decoder).ok()?;
        if orientation == image::metadata::Orientation::NoTransforms {
            let width = image.width();
            let height = image.height();
            if width == 0 || height == 0 {
                return None;
            }
            let bytes = if width <= MAX_EMBED_PX && height <= MAX_EMBED_PX {
                bytes
            } else {
                let image = image.thumbnail(MAX_EMBED_PX, MAX_EMBED_PX);
                let mut encoded = Vec::new();
                image::codecs::jpeg::JpegEncoder::new_with_quality(&mut encoded, 90)
                    .encode_image(&image)
                    .ok()?;
                return Some(ExportImage {
                    bytes: encoded,
                    width: image.width(),
                    height: image.height(),
                    size_pt: scaled_size_pt((width, height), (image.width(), image.height()), dpi),
                });
            };
            return Some(ExportImage {
                bytes,
                width,
                height,
                size_pt: size_pt(width, height, dpi),
            });
        }
    }
    prepare_png(bytes, dpi)
}

fn prepare_png(bytes: Vec<u8>, dpi: f64) -> Option<ExportImage> {
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
        return Some(ExportImage {
            bytes,
            width,
            height,
            size_pt: size_pt(width, height, dpi),
        });
    }
    let mut image = decode(&bytes)?;
    if width > MAX_EMBED_PX || height > MAX_EMBED_PX {
        image = image.thumbnail(MAX_EMBED_PX, MAX_EMBED_PX);
    }
    let mut png = Cursor::new(Vec::new());
    image.write_to(&mut png, ImageFormat::Png).ok()?;
    Some(ExportImage {
        bytes: png.into_inner(),
        width: image.width(),
        height: image.height(),
        size_pt: scaled_size_pt((width, height), (image.width(), image.height()), dpi),
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
        assert_eq!(display_size_pt(size_pt(100, 50, 96.0), PAGE), (75.0, 37.5));
    }

    #[test]
    fn wide_images_shrink_to_the_available_width() {
        let (w, h) = display_size_pt(size_pt(3000, 300, 96.0), PAGE);
        assert!((w - 453.5).abs() < 1e-6 && (h - 45.35).abs() < 1e-6);
    }

    #[test]
    fn tall_images_are_limited_by_the_available_height_keeping_ratio() {
        let (w, h) = display_size_pt(size_pt(400, 1600, 96.0), PAGE);
        assert!((h - 700.0).abs() < 1e-6);
        assert!((w / h - 0.25).abs() < 1e-9);
        // 为图注预留空间后高度相应减少，比例不变。
        let (w, h) = display_size_pt(size_pt(400, 1600, 96.0), Bounds { height: 650.0, ..PAGE });
        assert!((h - 650.0).abs() < 1e-6 && (w / h - 0.25).abs() < 1e-9);
    }

    #[test]
    fn narrow_containers_limit_the_width() {
        // 表格单元格等较窄的容器：按容器宽度缩小，保持比例，不按文字行高压成小图。
        let (w, h) = display_size_pt(size_pt(800, 400, 96.0), Bounds { width: 100.0, ..PAGE });
        assert!((w - 100.0).abs() < 1e-6 && (h - 50.0).abs() < 1e-6);
    }

    #[test]
    fn text_height_is_an_upper_bound_for_wrapped_lines() {
        assert_eq!(text_height_pt("图 1", 10.0, 18.0, 400.0), 18.0);
        // 100 个全角字符 × 10 磅 = 1000 磅，每行 40 字 → 3 行。
        assert_eq!(text_height_pt(&"很长的图注".repeat(20), 10.0, 18.0, 400.0), 54.0);
        // 按单词折行：每个 30 字符的单词占 300 磅，两个放不进 451 磅的一行 → 4 行。
        let words = vec!["W".repeat(30); 4].join(" ");
        assert_eq!(text_height_pt(&words, 10.0, 18.0, 451.0), 72.0);
        // 超过一行宽的单词按字符拆开。
        assert_eq!(text_height_pt(&"a".repeat(100), 10.0, 18.0, 400.0), 54.0);
    }

    #[test]
    fn png_is_used_as_is() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("图.png");
        write_image(&path, 40, 20, ImageFormat::Png);
        let image = load_for_export(&path).unwrap();
        assert_eq!((image.width, image.height), (40, 20));
        assert_eq!(image.bytes, fs::read(&path).unwrap());
    }

    #[test]
    fn gif_is_converted_to_png() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("a.gif");
        write_image(&path, 30, 10, ImageFormat::Gif);
        let image = load_for_export(&path).unwrap();
        assert_eq!((image.width, image.height), (30, 10));
        assert!(image.bytes.starts_with(&[137, 80, 78, 71]));
    }

    #[test]
    fn large_images_are_scaled_down() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("大.png");
        write_image(&path, 4800, 600, ImageFormat::Png);
        let image = load_for_export(&path).unwrap();
        assert_eq!((image.width, image.height), (2400, 300));
    }

    #[test]
    fn jpeg_and_png_bytes_are_preserved() {
        let dir = TempDir::new().unwrap();
        for (name, format) in [("a.jpg", ImageFormat::Jpeg), ("a.png", ImageFormat::Png)] {
            let path = dir.path().join(name);
            write_image(&path, 30, 10, format);
            let image = load_for_export(&path).unwrap();
            assert_eq!((image.width, image.height), (30, 10));
            assert_eq!(image.bytes, fs::read(&path).unwrap());
        }
    }

    #[test]
    fn large_jpeg_stays_jpeg_and_gif_becomes_png() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("large.jpg");
        write_image(&path, 4800, 600, ImageFormat::Jpeg);
        let image = load_for_export(&path).unwrap();
        assert_eq!((image.width, image.height), (2400, 300));
        assert_eq!(image::guess_format(&image.bytes).unwrap(), ImageFormat::Jpeg);
        assert_eq!(decode(&image.bytes).unwrap().width(), 2400);
        let path = dir.path().join("a.gif");
        write_image(&path, 30, 10, ImageFormat::Gif);
        let image = load_for_export(&path).unwrap();
        assert_eq!((image.width, image.height), (30, 10));
        assert_eq!(image::guess_format(&image.bytes).unwrap(), ImageFormat::Png);
    }

    #[test]
    fn rotated_jpeg_keeps_existing_display_direction() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("rotated.jpg");
        write_image(&path, 30, 10, ImageFormat::Jpeg);
        let bytes = fs::read(&path).unwrap();
        // APP1 / Exif：小端 TIFF，方向 6（顺时针旋转 90 度）。
        let exif = b"Exif\0\0II\x2a\0\x08\0\0\0\x01\0\x12\x01\x03\0\x01\0\0\0\x06\0\0\0\0\0\0\0";
        let mut rotated = bytes[..2].to_vec();
        rotated.extend_from_slice(&[0xff, 0xe1]);
        rotated.extend_from_slice(&((exif.len() + 2) as u16).to_be_bytes());
        rotated.extend_from_slice(exif);
        rotated.extend_from_slice(&bytes[2..]);
        fs::write(&path, rotated).unwrap();
        let image = load_for_export(&path).unwrap();
        assert_eq!((image.width, image.height), (30, 10));
        assert_eq!(image::guess_format(&image.bytes).unwrap(), ImageFormat::Png);
        assert_eq!(decode(&image.bytes).unwrap().to_rgb8(), decode(&bytes).unwrap().to_rgb8());
    }

    #[test]
    fn broken_or_missing_images_return_none() {
        let dir = TempDir::new().unwrap();
        let broken = dir.path().join("坏.png");
        fs::write(&broken, b"\x89PNG\r\n\x1a\nnot really").unwrap();
        assert!(load_for_export(&broken).is_none());
        let text = dir.path().join("文本.png");
        fs::write(&text, "这不是图片").unwrap();
        assert!(load_for_export(&text).is_none());
        assert!(load_for_export(&dir.path().join("无.png")).is_none());
    }

    /// 写一张带 pHYs 的 PNG（每米像素数与单位）。
    fn write_png_with_phys(path: &Path, width: u32, height: u32, x: u32, y: u32, unit: png::Unit) {
        let mut encoder = png::Encoder::new(fs::File::create(path).unwrap(), width, height);
        encoder.set_color(png::ColorType::Grayscale);
        encoder.set_pixel_dims(Some(png::PixelDimensions { xppu: x, yppu: y, unit }));
        let mut writer = encoder.write_header().unwrap();
        writer.write_image_data(&vec![128; (width * height) as usize]).unwrap();
    }

    /// 改写 JPEG 的 JFIF 密度（单位、横纵密度）。
    fn write_jpeg_with_jfif(path: &Path, width: u32, height: u32, unit: u8, x: u16, y: u16) {
        write_image(path, width, height, ImageFormat::Jpeg);
        let mut bytes = fs::read(path).unwrap();
        assert_eq!(&bytes[2..4], &[0xff, 0xe0]);
        assert_eq!(&bytes[6..11], b"JFIF\0");
        bytes[13] = unit;
        bytes[14..16].copy_from_slice(&x.to_be_bytes());
        bytes[16..18].copy_from_slice(&y.to_be_bytes());
        fs::write(path, bytes).unwrap();
    }

    fn natural_size(path: &Path) -> (f64, f64) {
        let (w, h) = load_for_export(path).unwrap().size_pt;
        ((w * 1000.0).round() / 1000.0, (h * 1000.0).round() / 1000.0)
    }

    #[test]
    fn png_dpi_from_phys_scales_the_natural_size() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("a.png");
        // Retina 截图：144 DPI（5669 像素 / 米），固有尺寸是 96 DPI 时的 2/3。
        write_png_with_phys(&path, 288, 144, 5669, 5669, png::Unit::Meter);
        let (w, h) = natural_size(&path);
        assert!((w - 144.0).abs() < 0.05 && (h - 72.0).abs() < 0.05, "{w} {h}");
        // 300 DPI：300 像素 = 1 英寸 = 72 磅。
        write_png_with_phys(&path, 300, 150, 11811, 11811, png::Unit::Meter);
        let (w, _) = natural_size(&path);
        assert!((w - 72.0).abs() < 0.05, "{w}");
    }

    #[test]
    fn missing_or_abnormal_png_dpi_falls_back_to_96() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("a.png");
        write_image(&path, 100, 50, ImageFormat::Png);
        assert_eq!(natural_size(&path), (75.0, 37.5));
        for (x, y, unit) in [
            (5669, 5669, png::Unit::Unspecified), // 只表示像素比例
            (39, 39, png::Unit::Meter),           // 约 1 DPI
            (2756, 2756, png::Unit::Meter),       // 70 DPI
            (5669, 11811, png::Unit::Meter),      // 横纵不同
            (47244, 47244, png::Unit::Meter),     // 1200 DPI
        ] {
            write_png_with_phys(&path, 100, 50, x, y, unit);
            assert_eq!(natural_size(&path), (75.0, 37.5), "{x} {y} {unit:?}");
        }
    }

    #[test]
    fn jpeg_dpi_from_jfif() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("a.jpg");
        write_jpeg_with_jfif(&path, 300, 150, 1, 300, 300);
        assert_eq!(natural_size(&path), (72.0, 36.0));
        // 每厘米：118 × 2.54 ≈ 299.7 DPI。
        write_jpeg_with_jfif(&path, 300, 150, 2, 118, 118);
        let (w, _) = natural_size(&path);
        assert!((w - 300.0 * 72.0 / (118.0 * 2.54)).abs() < 0.001, "{w}");
        // 单位 0 只表示比例；超出范围；横纵不同：按 96。
        for (unit, x, y) in [(0, 300, 300), (1, 1, 1), (1, 2400, 2400), (1, 300, 150)] {
            write_jpeg_with_jfif(&path, 300, 150, unit, x, y);
            assert_eq!(natural_size(&path), (225.0, 112.5), "{unit} {x} {y}");
        }
    }

    #[test]
    fn scaled_down_images_keep_the_original_natural_size() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("large.png");
        write_png_with_phys(&path, 4800, 600, 11811, 11811, png::Unit::Meter);
        let image = load_for_export(&path).unwrap();
        assert_eq!((image.width, image.height), (2400, 300));
        assert!((image.size_pt.0 - 4800.0 * 72.0 / 300.0).abs() < 0.5, "{:?}", image.size_pt);
        let path = dir.path().join("large.jpg");
        write_jpeg_with_jfif(&path, 4800, 600, 1, 300, 300);
        let image = load_for_export(&path).unwrap();
        assert_eq!((image.width, image.size_pt), (2400, (1152.0, 144.0)));
    }

    #[test]
    fn gif_uses_96_dpi() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("a.gif");
        write_image(&path, 40, 20, ImageFormat::Gif);
        assert_eq!(natural_size(&path), (30.0, 15.0));
    }

    #[test]
    fn truncated_png_is_rejected() {
        let dir = TempDir::new().unwrap();
        let path = dir.path().join("截断.png");
        write_image(&path, 50, 50, ImageFormat::Png);
        let bytes = fs::read(&path).unwrap();
        fs::write(&path, &bytes[..bytes.len() / 2]).unwrap();
        assert!(load_for_export(&path).is_none());
    }
}
