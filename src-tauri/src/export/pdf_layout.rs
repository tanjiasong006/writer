//! PDF 排版配置（docs/pdf-layout.md 第 4 节）：前端合并好的完整配置，只有语义取值。
//!
//! 默认值与前端 `domain/pdf_layout` 共享 `fixtures/pdf_layout_default.json`，两侧测试都读取它。
//! 这里把配置换算成页面尺寸（`PageSetup`）与输出参数（`Theme`），由 `pdf.rs` 生成 Typst 规则。

use serde::Deserialize;

use super::theme::{FontId, Theme};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Paper {
    A4,
    B5,
    A5,
    Letter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Margin {
    Narrow,
    Normal,
    Wide,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Binding {
    Single,
    Double,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum FontChoice {
    Serif,
    Sans,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum LineHeight {
    Compact,
    Normal,
    Loose,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ParagraphStyle {
    Indent,
    Spacing,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChapterNumber {
    /// 1、1.1
    Plain,
    /// 第 1 章、1.1
    Chapter,
    None,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum Header {
    None,
    Title,
    TitleAndChapter,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum PageNumber {
    /// 1
    Plain,
    /// 第 1 页
    Page,
    /// 1 / N
    Total,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum TableStyle {
    ThreeLine,
    Grid,
}

/// 正文字号只有三档（五号 / 小四 / 四号）。
#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(try_from = "f64")]
pub struct BodySize(f64);

impl TryFrom<f64> for BodySize {
    type Error = String;

    fn try_from(value: f64) -> Result<Self, Self::Error> {
        if [10.5, 12.0, 14.0].contains(&value) {
            Ok(BodySize(value))
        } else {
            Err(format!("unsupported body size {value}"))
        }
    }
}

/// 目录深度：1–3 级。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(try_from = "u8")]
pub struct TocDepth(u8);

impl TryFrom<u8> for TocDepth {
    type Error = String;

    fn try_from(value: u8) -> Result<Self, Self::Error> {
        if (1..=3).contains(&value) {
            Ok(TocDepth(value))
        } else {
            Err(format!("unsupported toc depth {value}"))
        }
    }
}

impl TocDepth {
    pub fn get(self) -> u8 {
        self.0
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PdfLayout {
    pub paper: Paper,
    pub margin: Margin,
    pub binding: Binding,
    pub body_font: FontChoice,
    pub heading_font: FontChoice,
    pub body_size: BodySize,
    pub line_height: LineHeight,
    pub paragraph: ParagraphStyle,
    pub cover: bool,
    pub toc: bool,
    pub toc_depth: TocDepth,
    pub chapter_new_page: bool,
    pub chapter_number: ChapterNumber,
    pub header: Header,
    pub page_number: PageNumber,
    pub table: TableStyle,
}

impl Default for PdfLayout {
    fn default() -> Self {
        PdfLayout {
            paper: Paper::A4,
            margin: Margin::Normal,
            binding: Binding::Single,
            body_font: FontChoice::Serif,
            heading_font: FontChoice::Sans,
            body_size: BodySize(12.0),
            line_height: LineHeight::Normal,
            paragraph: ParagraphStyle::Indent,
            cover: true,
            toc: true,
            toc_depth: TocDepth(2),
            chapter_new_page: true,
            chapter_number: ChapterNumber::Plain,
            header: Header::TitleAndChapter,
            page_number: PageNumber::Plain,
            table: TableStyle::ThreeLine,
        }
    }
}

/// 毫米 → 磅。
fn mm(value: f64) -> f64 {
    value / 25.4 * 72.0
}

/// 双面装订时内侧边距增加、外侧减少的量（毫米），正文区宽度不变。
const BINDING_SHIFT_MM: f64 = 5.0;

/// 页面尺寸与版心。
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct PageSetup {
    pub paper: Paper,
    /// 纸张宽、高（毫米）。
    pub width_mm: f64,
    pub height_mm: f64,
    /// 四边的基础页边距（毫米）；双面装订时内外侧再各自调整。
    pub margin_mm: f64,
    pub binding: Binding,
}

impl PageSetup {
    pub fn text_width_pt(&self) -> f64 {
        mm(self.width_mm - 2.0 * self.margin_mm)
    }

    pub fn text_height_pt(&self) -> f64 {
        mm(self.height_mm - 2.0 * self.margin_mm)
    }

    /// 内侧（装订侧）与外侧的页边距（毫米）。单面时相同。
    pub fn inside_outside_mm(&self) -> (f64, f64) {
        match self.binding {
            Binding::Single => (self.margin_mm, self.margin_mm),
            Binding::Double => (self.margin_mm + BINDING_SHIFT_MM, self.margin_mm - BINDING_SHIFT_MM),
        }
    }
}

impl PdfLayout {
    pub fn page(&self) -> PageSetup {
        // ISO 216（A4、A5、B5）与 US Letter。
        let (width_mm, height_mm) = match self.paper {
            Paper::A4 => (210.0, 297.0),
            Paper::B5 => (176.0, 250.0),
            Paper::A5 => (148.0, 210.0),
            Paper::Letter => (215.9, 279.4),
        };
        let margin_mm = match self.margin {
            Margin::Narrow => 18.0,
            Margin::Normal => 25.0,
            Margin::Wide => 32.0,
        };
        PageSetup {
            paper: self.paper,
            width_mm,
            height_mm,
            margin_mm,
            binding: self.binding,
        }
    }

    /// 正文字号相对默认小四（12 磅）的比例：其余元素的字号按它缩放。
    pub fn scale(&self) -> f64 {
        self.body_size.0 / 12.0
    }

    /// 由配置得到输出参数：从 PDF 默认值出发，替换正文与标题的字体族（引用固定为楷体）、行距与段距，字号按比例缩放。
    pub fn theme(&self) -> Theme {
        let base = Theme::pdf();
        let scale = self.scale();
        let font = |choice: FontChoice| match choice {
            FontChoice::Serif => FontId::Serif,
            FontChoice::Sans => FontId::Sans,
        };
        let body_font = font(self.body_font);
        let heading_font = font(self.heading_font);
        let heading = |style: super::theme::HeadingStyle| super::theme::HeadingStyle {
            font: heading_font,
            size: style.size * scale,
            ..style
        };
        Theme {
            body: super::theme::BodyStyle {
                font: body_font,
                size: self.body_size.0,
                line_height: match self.line_height {
                    LineHeight::Compact => 1.5,
                    LineHeight::Normal => 1.75,
                    LineHeight::Loose => 2.0,
                },
                paragraph_spacing: match self.paragraph {
                    ParagraphStyle::Indent => 0.0,
                    ParagraphStyle::Spacing => 0.5,
                },
            },
            title: super::theme::TextStyle {
                font: heading_font,
                size: base.title.size * scale,
            },
            heading1: heading(base.heading1),
            heading2: heading(base.heading2),
            heading3: heading(base.heading3),
            heading4: heading(base.heading4),
            blockquote: super::theme::TextStyle {
                font: base.blockquote.font,
                size: base.blockquote.size * scale,
            },
            code_block: base.code_block * scale,
            table: base.table * scale,
            image_spacing: base.image_spacing,
            caption: super::theme::TextStyle {
                font: body_font,
                size: base.caption.size * scale,
            },
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_matches_the_shared_fixture() {
        let text = std::fs::read_to_string(
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/pdf_layout_default.json"),
        )
        .unwrap();
        let shared: PdfLayout = serde_json::from_str(&text).unwrap();
        assert_eq!(shared, PdfLayout::default());
    }

    #[test]
    fn default_theme_is_the_pdf_default() {
        assert_eq!(PdfLayout::default().theme(), Theme::pdf());
    }

    #[test]
    fn rejects_values_outside_the_options() {
        let with = |field: &str, value: serde_json::Value| {
            let mut json: serde_json::Value = serde_json::from_str(
                &std::fs::read_to_string(
                    std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/pdf_layout_default.json"),
                )
                .unwrap(),
            )
            .unwrap();
            json[field] = value;
            serde_json::from_value::<PdfLayout>(json)
        };
        assert!(with("bodySize", serde_json::json!(13)).is_err());
        assert!(with("tocDepth", serde_json::json!(4)).is_err());
        assert!(with("paper", serde_json::json!("a3")).is_err());
        assert!(with("bodySize", serde_json::json!(10.5)).is_ok());
    }

    #[test]
    fn page_sizes_and_text_area() {
        let a4 = PdfLayout::default().page();
        assert!((a4.text_width_pt() - 453.54).abs() < 0.01);
        assert!((a4.text_height_pt() - 700.16).abs() < 0.01);
        let double = PdfLayout {
            binding: Binding::Double,
            margin: Margin::Narrow,
            ..PdfLayout::default()
        }
        .page();
        assert_eq!(double.inside_outside_mm(), (23.0, 13.0));
        // 双面装订只移动版心，不改变宽度。
        assert_eq!(double.text_width_pt(), PdfLayout { margin: Margin::Narrow, ..PdfLayout::default() }.page().text_width_pt());
    }

    #[test]
    fn theme_follows_fonts_spacing_and_body_size() {
        let theme = PdfLayout {
            body_font: FontChoice::Sans,
            heading_font: FontChoice::Serif,
            body_size: BodySize(14.0),
            line_height: LineHeight::Loose,
            paragraph: ParagraphStyle::Spacing,
            ..PdfLayout::default()
        }
        .theme();
        assert_eq!(theme.body.font, FontId::Sans);
        assert_eq!(theme.body.size, 14.0);
        assert_eq!(theme.body.line_height, 2.0);
        assert_eq!(theme.body.paragraph_spacing, 0.5);
        assert_eq!(theme.heading1.font, FontId::Serif);
        assert_eq!(theme.heading1.size, 21.0);
        assert_eq!(theme.blockquote.font, FontId::Kai, "quotes stay Kai whatever the body font");
        assert_eq!(theme.table, 10.5 * 14.0 / 12.0);
    }
}
