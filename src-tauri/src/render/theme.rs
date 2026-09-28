//! 文档主题：前端 `domain/document_style` 解析好的语义样式（主题 + 用户调整），以及图片布局。
//!
//! 这里只有语义参数（字体族、磅值、倍数），不含任何 CSS；预览（前端 CSS）、Word、PDF
//! 各自把它翻译成自己的样式（docs/decisions.md 第 8 节）。数值在进入渲染前限制在合法范围内，
//! 异常值不会让排版引擎出错。

use serde::Deserialize;

/// 受控的字体族；具体字体的 fallback 链见 `export::fonts`。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum FontId {
    Serif,
    Sans,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageSize {
    /// 按图片本身大小（96 DPI），不超过正文宽度。
    Original,
    Small,
    Medium,
    Large,
    Full,
}

impl ImageSize {
    /// 占正文宽度的比例；original 没有固定比例。与前端 `IMAGE_WIDTH_RATIO` 一致。
    pub fn width_ratio(self) -> Option<f64> {
        match self {
            ImageSize::Original => None,
            ImageSize::Small => Some(0.4),
            ImageSize::Medium => Some(0.65),
            ImageSize::Large => Some(0.85),
            ImageSize::Full => Some(1.0),
        }
    }

    pub fn as_str(self) -> &'static str {
        match self {
            ImageSize::Original => "original",
            ImageSize::Small => "small",
            ImageSize::Medium => "medium",
            ImageSize::Large => "large",
            ImageSize::Full => "full",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ImageAlign {
    Left,
    Center,
    Right,
}

impl ImageAlign {
    pub fn as_str(self) -> &'static str {
        match self {
            ImageAlign::Left => "left",
            ImageAlign::Center => "center",
            ImageAlign::Right => "right",
        }
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct TextStyle {
    pub font: FontId,
    /// 磅。
    pub size: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct BodyStyle {
    pub font: FontId,
    pub size: f64,
    /// 相邻两行基线的距离 / 字号。
    pub line_height: f64,
    /// 段落之间在正常行距之外额外的间距（em）。
    pub paragraph_spacing: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct HeadingStyle {
    pub font: FontId,
    pub size: f64,
    /// 标题前后的间距（em，相对标题字号）。
    pub spacing_before: f64,
    pub spacing_after: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct SizeStyle {
    pub size: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
pub struct ImageDefaults {
    pub size: ImageSize,
    pub align: ImageAlign,
    /// 独立成段的图片前后的间距（em，相对正文字号）。
    pub spacing: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Theme {
    pub body: BodyStyle,
    pub title: TextStyle,
    pub heading1: HeadingStyle,
    pub heading2: HeadingStyle,
    pub heading3: HeadingStyle,
    pub blockquote: TextStyle,
    pub code_block: SizeStyle,
    pub table: SizeStyle,
    pub image: ImageDefaults,
    pub caption: TextStyle,
}

/// 单张图片的布局；缺少的字段跟随主题。
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, Deserialize)]
pub struct ImageOverride {
    pub size: Option<ImageSize>,
    pub align: Option<ImageAlign>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ImageLayout {
    pub size: ImageSize,
    pub align: ImageAlign,
}

const SIZE_RANGE: (f64, f64) = (6.0, 72.0);
const LINE_HEIGHT_RANGE: (f64, f64) = (1.0, 3.0);
const SPACING_RANGE: (f64, f64) = (0.0, 5.0);

fn clamp(value: f64, (min, max): (f64, f64)) -> f64 {
    if value.is_finite() {
        value.clamp(min, max)
    } else {
        min
    }
}

impl TextStyle {
    fn sanitized(self) -> Self {
        TextStyle {
            size: clamp(self.size, SIZE_RANGE),
            ..self
        }
    }
}

impl HeadingStyle {
    fn sanitized(self) -> Self {
        HeadingStyle {
            size: clamp(self.size, SIZE_RANGE),
            spacing_before: clamp(self.spacing_before, SPACING_RANGE),
            spacing_after: clamp(self.spacing_after, SPACING_RANGE),
            ..self
        }
    }
}

impl SizeStyle {
    fn sanitized(self) -> Self {
        SizeStyle {
            size: clamp(self.size, SIZE_RANGE),
        }
    }
}

impl Theme {
    /// 把所有数值限制在合法范围内（非有限值取下限）。
    pub fn sanitized(self) -> Self {
        Theme {
            body: BodyStyle {
                size: clamp(self.body.size, SIZE_RANGE),
                line_height: clamp(self.body.line_height, LINE_HEIGHT_RANGE),
                paragraph_spacing: clamp(self.body.paragraph_spacing, SPACING_RANGE),
                ..self.body
            },
            title: self.title.sanitized(),
            heading1: self.heading1.sanitized(),
            heading2: self.heading2.sanitized(),
            heading3: self.heading3.sanitized(),
            blockquote: self.blockquote.sanitized(),
            code_block: self.code_block.sanitized(),
            table: self.table.sanitized(),
            image: ImageDefaults {
                spacing: clamp(self.image.spacing, SPACING_RANGE),
                ..self.image
            },
            caption: self.caption.sanitized(),
        }
    }

    /// 第 level 级标题（从 1 开始）的样式：第 3 级及更深使用 heading3。与前端 `headingStyle` 一致。
    pub fn heading(&self, level: usize) -> &HeadingStyle {
        match level {
            0 | 1 => &self.heading1,
            2 => &self.heading2,
            _ => &self.heading3,
        }
    }

    /// 图片实际使用的布局：图片自己的设置优先，其余跟随主题。
    pub fn image_layout(&self, image: Option<&ImageOverride>) -> ImageLayout {
        ImageLayout {
            size: image.and_then(|o| o.size).unwrap_or(self.image.size),
            align: image.and_then(|o| o.align).unwrap_or(self.image.align),
        }
    }
}

/// 测试用的默认主题：与前端默认主题共用 `fixtures/default-theme.json`（前端测试保证两者一致）。
#[cfg(test)]
pub fn test_theme() -> Theme {
    serde_json::from_str(include_str!("../../fixtures/default-theme.json")).unwrap()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_theme_fixture_deserializes() {
        let theme = test_theme();
        assert_eq!(theme.body.font, FontId::Serif);
        assert_eq!(theme.body.size, 12.0);
        assert_eq!(theme.heading(1).size, 16.0);
        assert_eq!(theme.heading(3).size, 13.0);
        assert_eq!(theme.heading(8), &theme.heading3);
        assert_eq!(theme.image.size, ImageSize::Original);
    }

    #[test]
    fn sanitize_clamps_out_of_range_values() {
        let mut theme = test_theme();
        theme.body.size = 1000.0;
        theme.body.line_height = f64::NAN;
        theme.heading1.spacing_before = -3.0;
        theme.table.size = 0.0;
        let theme = theme.sanitized();
        assert_eq!(theme.body.size, 72.0);
        assert_eq!(theme.body.line_height, 1.0);
        assert_eq!(theme.heading1.spacing_before, 0.0);
        assert_eq!(theme.table.size, 6.0);
    }

    #[test]
    fn image_layout_prefers_override() {
        let theme = test_theme();
        assert_eq!(
            theme.image_layout(None),
            ImageLayout {
                size: ImageSize::Original,
                align: ImageAlign::Center
            }
        );
        let partial = ImageOverride {
            size: Some(ImageSize::Small),
            align: None,
        };
        assert_eq!(
            theme.image_layout(Some(&partial)),
            ImageLayout {
                size: ImageSize::Small,
                align: ImageAlign::Center
            }
        );
    }

    #[test]
    fn unknown_values_are_rejected() {
        let json =
            include_str!("../../fixtures/default-theme.json").replace("\"serif\"", "\"comic\"");
        assert!(serde_json::from_str::<Theme>(&json).is_err());
        assert!(serde_json::from_str::<ImageOverride>(r#"{"size":"huge"}"#).is_err());
    }
}
