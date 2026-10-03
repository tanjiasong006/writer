//! 公式（docs/decisions.md 第 14 节）：正文中的 LaTeX → Typst 公式。
//!
//! - 转换由 `mitex` 完成；转换结果中的辅助名称由 vendored 的 mitex 规格（`vendor/mitex-specs`，见其 WRITER-PATCH.md）
//!   定义，作为虚拟文件 `/mitex/…` 提供给 Typst，公式以 `eval(…, mode: "math", scope: mitex-scope)` 求值。
//! - PDF 中直接排版；Word 中把每个公式用同样的 Typst 排版渲染为 PNG 图片嵌入（不生成 OMML，接收者不能编辑公式）。
//! - 转换或排版失败的公式不让导出失败：以红色的 LaTeX 原文输出并列入导出报告。

use typst::syntax::{DiagSpanKind, Source};
use typst_layout::PagedDocument;
use typst_kit::fonts::FontStore;

/// 规格文件（虚拟路径与内容）。
pub const SCOPE_FILES: [(&str, &str); 3] = [
    ("/mitex/mod.typ", include_str!("../../vendor/mitex-specs/mod.typ")),
    ("/mitex/prelude.typ", include_str!("../../vendor/mitex-specs/prelude.typ")),
    ("/mitex/latex/standard.typ", include_str!("../../vendor/mitex-specs/latex/standard.typ")),
];

/// 在 Typst 源码中导入规格（使用公式之前）。
pub const SCOPE_IMPORT: &str = "#import \"/mitex/mod.typ\": mitex-scope\n";

/// LaTeX → Typst 公式代码；不认识的命令等转换失败时为 None。
pub fn to_typst(tex: &str) -> Option<String> {
    let tex = tex.trim();
    if tex.is_empty() {
        return None;
    }
    std::panic::catch_unwind(|| mitex::convert_math(tex, None)).ok()?.ok()
}

/// 求值转换结果的 Typst 表达式（得到公式内容）。
pub fn eval_expression(typst: &str) -> String {
    format!("eval({}, mode: \"math\", scope: mitex-scope)", super::pdf::string_literal(typst))
}

/// 失败时的替代：红色的 LaTeX 原文（等宽）。
pub fn fallback_expression(tex: &str) -> String {
    format!("text(fill: rgb(\"#b91c1c\"), raw({}))", super::pdf::string_literal(tex.trim()))
}

/// 渲染好的公式图片（Word 中使用）。
pub struct FormulaImage {
    pub png: Vec<u8>,
    /// 像素尺寸。
    pub width_px: u32,
    pub height_px: u32,
    /// 显示尺寸（磅）。
    pub width_pt: f64,
    pub height_pt: f64,
}

/// 图片的分辨率：每磅的像素数（约 288 DPI，打印清晰）。
const PIXELS_PER_PT: f64 = 4.0;

/// 用 Typst 排版一个公式并渲染为 PNG；size_pt 是正文字号。失败时为 None。
pub fn render_png(tex: &str, display: bool, size_pt: f64, fonts: &'static FontStore) -> Option<FormulaImage> {
    let typst = to_typst(tex)?;
    let source = format!(
        "{SCOPE_IMPORT}#set page(width: auto, height: auto, margin: (x: 0.5pt, y: 1pt), fill: none)\n\
         #set text(size: {size_pt}pt)\n\
         #math.equation(block: {display}, {})\n",
        eval_expression(&typst)
    );
    let world = super::pdf::PdfWorld::new(source, Vec::new(), fonts);
    let document = typst::compile::<PagedDocument>(&world).output.ok()?;
    let page = document.pages().first()?;
    let size = page.frame.size();
    let options = typst_render::RenderOptions {
        pixel_per_pt: typst::utils::Scalar::new(PIXELS_PER_PT),
        ..Default::default()
    };
    let pixmap = typst_render::render(page, &options);
    let png = pixmap.encode_png().ok()?;
    Some(FormulaImage {
        png,
        width_px: pixmap.width(),
        height_px: pixmap.height(),
        width_pt: size.x.to_pt(),
        height_pt: size.y.to_pt(),
    })
}

/// 主源码中的公式定义：`#let writer-math-<n> = …`，每个公式一行，返回源码与各行的字节范围（相对开头）。
/// invalid 中的公式使用替代（转换失败或排版时出错的）。
pub fn definitions(formulas: &[(String, Option<String>)], invalid: &std::collections::HashSet<usize>) -> (String, Vec<std::ops::Range<usize>>) {
    let mut out = String::from(SCOPE_IMPORT);
    let mut ranges = Vec::with_capacity(formulas.len());
    for (index, (tex, typst)) in formulas.iter().enumerate() {
        let start = out.len();
        let value = match typst {
            Some(typst) if !invalid.contains(&index) => eval_expression(typst),
            _ => fallback_expression(tex),
        };
        out.push_str(&format!("#let writer-math-{index} = {value}\n"));
        ranges.push(start..out.len());
    }
    (out, ranges)
}

/// 编译错误所在（或经过）的主源码位置。
pub fn error_offsets(source: &Source, errors: &[typst::diag::SourceDiagnostic]) -> Vec<usize> {
    let mut offsets = Vec::new();
    for error in errors {
        match error.span.get() {
            DiagSpanKind::Number { id, num, sub_range } if id == source.id() => {
                offsets.extend(source.range(num, sub_range).map(|range| range.start))
            }
            DiagSpanKind::Range { id, range } if id == source.id() => offsets.push(range.start),
            _ => {}
        }
        for point in &error.trace {
            offsets.extend(source.find(point.span).map(|node| node.range().start));
        }
    }
    offsets
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn converts_common_latex() {
        assert_eq!(to_typst(r"\frac{a}{b}").as_deref(), Some("frac(a ,b )"));
        assert!(to_typst(r"\unknowncommand{x}").is_none());
        assert!(to_typst("  ").is_none());
    }
}
