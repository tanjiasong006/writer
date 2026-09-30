//! 导出的默认输出参数：字体族、字号、行距、段距、各级标题、引用、代码、表格、图注。
//!
//! 这是 Word 与 PDF 的输出参数类型，与编辑环境的展示参数无关，也不来自项目数据
//! （docs/decisions.md 第 5、8 节）。Word 与 PDF 各自取得默认值（目前取值相同）；
//! 未来的 PDF 排版配置独立传入，不恢复共享主题。只有语义参数，不含任何 CSS。

/// 受控的字体族；具体字体的 fallback 链见 `export::fonts`。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FontId {
    Serif,
    Sans,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct TextStyle {
    pub font: FontId,
    /// 磅。
    pub size: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct BodyStyle {
    pub font: FontId,
    pub size: f64,
    /// 相邻两行基线的距离 / 字号。
    pub line_height: f64,
    /// 段落之间在正常行距之外额外的间距（em）。
    pub paragraph_spacing: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct HeadingStyle {
    pub font: FontId,
    pub size: f64,
    /// 标题前后的间距（em，相对标题字号）。
    pub spacing_before: f64,
    pub spacing_after: f64,
}

#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Theme {
    pub body: BodyStyle,
    pub title: TextStyle,
    pub heading1: HeadingStyle,
    pub heading2: HeadingStyle,
    pub heading3: HeadingStyle,
    pub blockquote: TextStyle,
    /// 代码块字号（字体固定为等宽）。
    pub code_block: f64,
    pub table: f64,
    /// 独立成段的图片前后的间距（em，相对正文字号）。
    pub image_spacing: f64,
    pub caption: TextStyle,
}

const fn heading(font: FontId, size: f64, spacing_before: f64, spacing_after: f64) -> HeadingStyle {
    HeadingStyle {
        font,
        size,
        spacing_before,
        spacing_after,
    }
}

impl Default for Theme {
    /// 默认输出参数：宋体类正文、黑体类标题，适合正式交付的长文档。
    fn default() -> Self {
        Theme {
            body: BodyStyle {
                font: FontId::Serif,
                size: 12.0,
                line_height: 1.8,
                paragraph_spacing: 0.5,
            },
            title: TextStyle {
                font: FontId::Sans,
                size: 22.0,
            },
            heading1: heading(FontId::Sans, 16.0, 1.4, 0.6),
            heading2: heading(FontId::Sans, 14.0, 1.2, 0.5),
            heading3: heading(FontId::Sans, 13.0, 1.0, 0.4),
            blockquote: TextStyle {
                font: FontId::Serif,
                size: 12.0,
            },
            code_block: 10.0,
            table: 11.0,
            image_spacing: 1.0,
            caption: TextStyle {
                font: FontId::Serif,
                size: 10.0,
            },
        }
    }
}

impl Theme {
    /// 第 level 级标题（从 1 开始）的样式：第 3 级及更深使用 heading3。
    pub fn heading(&self, level: usize) -> &HeadingStyle {
        match level {
            0 | 1 => &self.heading1,
            2 => &self.heading2,
            _ => &self.heading3,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn deeper_headings_share_the_third_level_style() {
        let theme = Theme::default();
        assert_eq!(theme.heading(1).size, 16.0);
        assert_eq!(theme.heading(3).size, 13.0);
        assert_eq!(theme.heading(8), &theme.heading3);
    }
}
