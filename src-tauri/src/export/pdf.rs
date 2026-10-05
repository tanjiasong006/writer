//! PDF 导出：把 `render::Document` 生成 Typst 源码，用内嵌的 Typst 排版为 PDF。
//!
//! - 用户文本一律以 Typst 字符串字面量（`#"..."`）注入，不存在"正文里的符号被当作 Typst 语法"的问题。
//! - 排版按 PDF 排版配置（`export::pdf_layout`）：页面尺寸、输出参数与页面结构（封面、目录、
//!   一级章节另起一页、页眉页码等）在 preamble 中翻译成 Typst 的 set / show 规则（docs/pdf-layout.md）。
//! - 图片按统一规则自动排版（`export::images`）：保持比例、不放大，不超过所在容器的宽度与完整正文区高度；
//!   独立成段的图片居中，有图注时为图注预留空间。尺寸与图片落在页上的位置无关：当前页放不下时，
//!   图片与图注作为一个整体移到下一页，不为塞进页底而缩小。
//! - 字体来自 `fonts.rs` 的字体族 fallback 链；只保留本机实际存在的字体族，Typst 还会对缺字逐字形回退。
//! - 文档含中文而本机没有任何能显示中文的字体时报 `NoCjkFont`，不静默输出缺字。
//! - Typst 的文件 id 全局驻留且数量有上限，因此虚拟路径固定（/main.typ、/img/<序号>.png），
//!   每次导出后清理 comemo 缓存，长时间运行的应用不会累积内存。

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::OnceLock;

use typst::diag::{FileError, FileResult, Severity};
use typst::foundations::{Bytes, Datetime, Duration};
use typst::syntax::{FileId, RootedPath, Source, VirtualPath, VirtualRoot};
use typst::text::{Font, FontBook};
use typst::utils::LazyHash;
use typst::{Library, LibraryExt, World};
use typst_kit::fonts::FontStore;
use typst_layout::PagedDocument;

use super::fonts::{bundled_font_dirs, families, FontFamily, CJK_PROBE};
use super::images::{display_size_pt, load_for_export, Bounds};
use super::pdf_layout::{Binding, ChapterNumber, Header, PageNumber, PageSetup, ParagraphStyle, PdfLayout, TableStyle};
use super::theme::{HeadingStyle, Theme};
use super::{math, ExportError, ExportReport};
use crate::render::chapter_reference::{broken_references, ref_text, ChapterTargets, RefShow};
use crate::render::citations::Citations;
use crate::render::elements::ElementTargets;
use crate::render::markdown::{cell_place, plain_text, Align, Block, CellPlace, CellSpan, Inline, StructureConditions};
use crate::render::{resolve_image, Document, Section, StructureImage, StructureKey};

/// Typst 字符串字面量（供公式模块使用）。
pub(crate) fn string_literal(text: &str) -> String {
    string(text)
}

/// 图片高度上限再留出的余量（磅），吸收取整差异，保证图片与图注不会被挤出正文区。
const IMAGE_HEIGHT_SLACK: f64 = 2.0;
/// Typst figure 中图片与图注之间的默认间距（em，相对正文字号）。
const FIGURE_GAP_EM: f64 = 0.65;
/// 行框在基线下方的部分（em），与 preamble 中的 `bottom-edge` 一致。
const TEXT_BOTTOM_EDGE_EM: f64 = 0.2;
/// 表格单元格的内边距（磅），与 preamble 中的 `table(inset: …)` 一致。
const TABLE_INSET_PT: f64 = 6.0;
/// 标题的行高（字号的倍数）。
const HEADING_LINE_HEIGHT: f64 = 1.4;
/// 正文段落的首行缩进（em）。
const FIRST_LINE_INDENT_EM: f64 = 2.0;
/// 一级章节另起一页后，标题上方的留白（磅）。
const CHAPTER_TOP_SPACE_PT: f64 = 36.0;
/// 页眉、页码的字号（磅）。
const META_TEXT_PT: f64 = 9.0;
/// 封面上副标题与作者的字号（磅）。
const COVER_SUBTITLE_PT: f64 = 16.0;
const COVER_AUTHOR_PT: f64 = 12.0;

static FONTS: OnceLock<FontStore> = OnceLock::new();

/// 字体库：内嵌字体 + 打包字体目录 + 系统字体。扫描系统字体较慢，全进程只做一次。
pub fn font_store(resource_dir: Option<&Path>) -> &'static FontStore {
    FONTS.get_or_init(|| {
        let mut store = FontStore::new();
        for dir in bundled_font_dirs(resource_dir) {
            if dir.is_dir() {
                store.extend(typst_kit::fonts::scan(&dir));
            }
        }
        store.extend(typst_kit::fonts::system());
        store.extend(typst_kit::fonts::embedded());
        store
    })
}

/// 排版：生成 Typst 源码并编译成分页文档。
fn layout(
    document: &Document,
    project_root: &Path,
    fonts: &'static FontStore,
    pdf_layout: &PdfLayout,
) -> Result<(PagedDocument, ExportReport), ExportError> {
    let book = fonts.book();
    if document_has_cjk(document) && !book_has_cjk(book) {
        return Err(ExportError::NoCjkFont);
    }

    let mut writer = Writer::new(project_root, pdf_layout);
    writer.targets = ChapterTargets::new(document);
    writer.elements = ElementTargets::new(document);
    writer.citations = Citations::new(document);
    writer.report.broken_references = broken_references(document);
    writer.structures = document.structures.clone();
    writer.preamble(document, book);
    for section in &document.sections {
        writer.section(section);
    }
    writer.bibliography();

    // 公式定义放在源码开头（docs/decisions.md 第 14 节）。某个公式排版出错时改用替代再排一次，不让整个导出失败。
    let mut invalid: std::collections::HashSet<usize> = writer
        .formulas
        .iter()
        .enumerate()
        .filter(|(_, (_, typst))| typst.is_none())
        .map(|(index, _)| index)
        .collect();
    loop {
        let (definitions, ranges) = if writer.formulas.is_empty() {
            (String::new(), Vec::new())
        } else {
            math::definitions(&writer.formulas, &invalid)
        };
        let world = PdfWorld::new(format!("{definitions}{}", writer.out), writer.images.clone(), fonts);
        match typst::compile::<PagedDocument>(&world).output {
            Ok(paged) => {
                let mut indices: Vec<usize> = invalid.into_iter().collect();
                indices.sort_unstable();
                writer.report.invalid_formulas = indices.into_iter().map(|i| writer.formulas[i].0.trim().to_owned()).collect();
                return Ok((paged, writer.report));
            }
            Err(errors) => {
                let failing: Vec<usize> = math::error_offsets(&world.main, &errors)
                    .into_iter()
                    .filter_map(|offset| ranges.iter().position(|range| range.contains(&offset)))
                    .filter(|index| !invalid.contains(index))
                    .collect();
                if failing.is_empty() {
                    return Err(render_failed(&errors));
                }
                invalid.extend(failing);
            }
        }
    }
}

pub fn export(
    document: &Document,
    project_root: &Path,
    fonts: &'static FontStore,
    pdf_layout: &PdfLayout,
) -> Result<(Vec<u8>, ExportReport), ExportError> {
    let result = layout(document, project_root, fonts, pdf_layout).and_then(|(paged, report)| {
        typst_pdf::pdf(&paged, &typst_pdf::PdfOptions::default())
            .map(|pdf| (pdf, report))
            .map_err(|errors| render_failed(&errors))
    });
    // 一次性导出不需要保留增量编译缓存。
    comemo::evict(0);
    result
}

/// 排版设置中的样张最多显示的页数。
const PREVIEW_MAX_PAGES: usize = 8;

/// 样张：与导出相同的排版，前若干页渲染为 SVG（排版设置中显示，docs/pdf-layout.md 第 5 节）。
/// 内容由调用方取文档开头的一部分，这里只限制返回的页数。
pub fn preview(
    document: &Document,
    project_root: &Path,
    fonts: &'static FontStore,
    pdf_layout: &PdfLayout,
) -> Result<Vec<String>, ExportError> {
    let result = layout(document, project_root, fonts, pdf_layout).map(|(paged, _)| {
        let options = typst_svg::SvgOptions::default();
        paged
            .pages()
            .iter()
            .take(PREVIEW_MAX_PAGES)
            .map(|page| typst_svg::svg(page, &options))
            .collect()
    });
    comemo::evict(0);
    result
}

fn render_failed(errors: &[typst::diag::SourceDiagnostic]) -> ExportError {
    let message = errors
        .iter()
        .find(|e| e.severity == Severity::Error)
        .or(errors.first())
        .map(|e| e.message.to_string())
        .unwrap_or_else(|| "unknown error".into());
    ExportError::RenderFailed { message }
}

fn document_has_cjk(document: &Document) -> bool {
    fn inlines_have_cjk(inlines: &[Inline]) -> bool {
        plain_text(inlines).chars().any(is_cjk)
    }
    fn blocks_have_cjk(blocks: &[Block]) -> bool {
        blocks.iter().any(|block| match block {
            Block::Paragraph(inlines) => inlines_have_cjk(inlines),
            Block::List { items, .. } => items.iter().any(|item| blocks_have_cjk(item)),
            Block::Quote(blocks) => blocks_have_cjk(blocks),
            Block::Code { text, .. } => text.chars().any(is_cjk),
            Block::Structure { .. } => false,
            Block::Table { header, rows, note, .. } => {
                header.iter().any(|c| inlines_have_cjk(c))
                    || rows.iter().flatten().any(|c| inlines_have_cjk(c))
                    || note.as_deref().is_some_and(|note| note.chars().any(is_cjk))
            }
            Block::Rule => false,
        })
    }
    document.title.chars().any(is_cjk)
        || document
            .sections
            .iter()
            .any(|s| s.title.chars().any(is_cjk) || blocks_have_cjk(&s.blocks))
}

fn is_cjk(c: char) -> bool {
    matches!(c, '\u{3040}'..='\u{30FF}' | '\u{3400}'..='\u{4DBF}' | '\u{4E00}'..='\u{9FFF}' | '\u{AC00}'..='\u{D7AF}' | '\u{F900}'..='\u{FAFF}')
}

fn book_has_cjk(book: &FontBook) -> bool {
    (0..)
        .map_while(|i| book.info(i))
        .any(|info| info.coverage.contains(u32::from(CJK_PROBE)))
}

/// 字体族的候选字体中本机实际存在的部分；都不存在时返回空（交给 Typst 的回退）。
fn available_families(book: &FontBook, family: FontFamily) -> Vec<&'static str> {
    families(family)
        .iter()
        .copied()
        .filter(|family| book.contains_family(&family.to_lowercase()))
        .collect()
}

/// 图片所在的容器：宽度上限（磅）与高度上限（Typst 长度表达式）。
struct Container {
    width: f64,
    max_height: String,
}

/// 与文字同行的图片立在基线上，所在行比图片多出基线下方的部分（按图片所在处的字号）。
/// 一行不能跨页拆开，要求整行放得进一页时，从高度上限中扣除这一部分。
fn line_limit(max_height: &str) -> String {
    format!("{max_height} - {}em.to-absolute()", num(TEXT_BOTTOM_EDGE_EM))
}

impl Container {
    /// 正文中的段落与标题：完整正文区。
    fn text_area(page: &PageSetup) -> Self {
        Container {
            width: page.text_width_pt(),
            max_height: line_limit(&format!("{}pt", num(page.text_height_pt() - IMAGE_HEIGHT_SLACK))),
        }
    }
}

#[derive(Clone, Copy)]
struct PreparedImage {
    index: usize,
    /// 固有尺寸（磅）。
    size_pt: (f64, f64),
    format: &'static str,
}

struct Writer<'a> {
    layout: PdfLayout,
    page: PageSetup,
    theme: Theme,
    root: &'a Path,
    out: String,
    images: Vec<Bytes>,
    /// 单次导出内复用安全解析后的文件；不缓存每次出现的显示尺寸。
    image_cache: HashMap<PathBuf, PreparedImage>,
    report: ExportReport,
    /// 引用使用的字体列表（preamble 中按输出参数确定）。
    quote_font: String,
    /// 封面关闭时文档信息放在正文首页顶部，第一章紧接其后，不另起一页。
    title_block_before_body: bool,
    /// 章节引用的目标；默认不含任何章节。
    targets: ChapterTargets,
    /// 图表的编号与引用目标（docs/decisions.md 第 12 节）。
    elements: ElementTargets,
    /// 文献引用的编号（docs/decisions.md 第 13 节）。
    citations: Citations,
    /// 正文中的公式：LaTeX 原文与转换结果（转换失败为 None），按出现顺序，相同的公式只有一项。
    formulas: Vec<(String, Option<String>)>,
    formula_index: HashMap<String, usize>,
    /// 化学结构式的图片（docs/decisions.md 第 22 节），按 SMILES；同一结构式只嵌入一次（images 中的序号）。
    structures: HashMap<StructureKey, StructureImage>,
    structure_index: HashMap<StructureKey, usize>,
}

impl<'a> Writer<'a> {
    fn new(root: &'a Path, layout: &PdfLayout) -> Self {
        Writer {
            layout: *layout,
            page: layout.page(),
            theme: layout.theme(),
            root,
            out: String::new(),
            images: Vec::new(),
            image_cache: HashMap::new(),
            report: ExportReport::default(),
            quote_font: String::new(),
            title_block_before_body: false,
            targets: ChapterTargets::default(),
            elements: ElementTargets::default(),
            citations: Citations::default(),
            formulas: Vec::new(),
            formula_index: HashMap::new(),
            structures: HashMap::new(),
            structure_index: HashMap::new(),
        }
    }

    /// 文档级样式与页面结构，按排版配置生成（docs/pdf-layout.md 第 3、4 节）：
    /// 封面 → 目录（罗马数字页码）→ 正文（页眉，页码从 1 开始）。之后依次输出各章节。
    fn preamble(&mut self, document: &Document, book: &FontBook) {
        let font_list = |family: FontFamily| {
            let names = available_families(book, family);
            if names.is_empty() {
                // 保证语法合法：让 Typst 使用内嵌默认字体 + 逐字形回退。
                "(\"libertinus serif\",)".to_owned()
            } else {
                format!(
                    "({},)",
                    names
                        .iter()
                        .map(|n| string(n))
                        .collect::<Vec<_>>()
                        .join(", ")
                )
            }
        };
        let layout = self.layout;
        let page = self.page;
        let theme = self.theme;
        let body = &theme.body;
        let scale = layout.scale();
        let double = layout.binding == Binding::Double;
        let mono = font_list(FontFamily::Mono);
        let sans = font_list(FontFamily::Sans);
        let title = string(&document.title);
        // 标题前后的间距按"行框之外的外边距"定义，行框本身含半个行距（标题行高 1.4、正文按输出行距）；
        // 这里的排版框是 1em，因此把两侧的半个行距补进标题前后的间距。
        let body_half_leading = (body.line_height - 1.0) / 2.0 * body.size;
        let heading_rules = |selector: &str, style: &HeadingStyle| {
            let half_leading = (HEADING_LINE_HEIGHT - 1.0) / 2.0 * style.size;
            format!(
                "#show {selector}: set text(font: {font}, size: {size}pt)\n\
                 #show {selector}: set block(above: {above}pt, below: {below}pt)\n",
                font = font_list(style.font.into()),
                size = num(style.size),
                above = num(style.spacing_before * style.size + half_leading + body_half_leading),
                below = num(style.spacing_after * style.size + half_leading + body_half_leading),
            )
        };
        let (inside, outside) = page.inside_outside_mm();
        self.out.push_str(&format!(
            "#set document(title: {title}, author: {author})\n\
             #set page(width: {width}mm, height: {height}mm, margin: (top: {margin}mm, bottom: {margin}mm, inside: {inside}mm, outside: {outside}mm), numbering: none, header: none, footer: none)\n\
             #set text(font: {body_font}, size: {body_size}pt, lang: \"zh\", region: \"cn\", top-edge: 0.8em, bottom-edge: -{bottom_edge}em)\n\
             #set par(justify: true, leading: {leading}em, spacing: {spacing}em, first-line-indent: (amount: {indent}em, all: true))\n\
             #set heading(numbering: none)\n",
            author = if document.author.trim().is_empty() {
                "()".to_owned()
            } else {
                string(document.author.trim())
            },
            width = num(page.width_mm),
            height = num(page.height_mm),
            margin = num(page.margin_mm),
            inside = num(inside),
            outside = num(outside),
            body_font = font_list(body.font.into()),
            bottom_edge = num(TEXT_BOTTOM_EDGE_EM),
            body_size = num(body.size),
            // 每行的排版框固定为 1em（基线上 0.8em、下 0.2em）：相邻基线距离 = 1em + leading = 行距倍数，
            // 与字体自身的度量无关。
            leading = num(body.line_height - 1.0),
            // 段距在行距之外再加 paragraph_spacing。
            spacing = num(body.line_height - 1.0 + body.paragraph_spacing),
            indent = num(match layout.paragraph {
                ParagraphStyle::Indent => FIRST_LINE_INDENT_EM,
                ParagraphStyle::Spacing => 0.0,
            }),
        ));
        // 更深的标题规则在前，第 1–3 级的规则在后，优先生效。
        self.out
            .push_str(&heading_rules("heading", &theme.heading4));
        self.out
            .push_str(&heading_rules("heading.where(level: 3)", &theme.heading3));
        self.out
            .push_str(&heading_rules("heading.where(level: 1)", &theme.heading1));
        self.out
            .push_str(&heading_rules("heading.where(level: 2)", &theme.heading2));
        let table_stroke = match layout.table {
            TableStyle::ThreeLine => "none",
            TableStyle::Grid => "0.5pt + luma(160)",
        };
        self.out.push_str(&format!(
            "#show list: set par(first-line-indent: 0em)\n\
             #show enum: set par(first-line-indent: 0em)\n\
             #show table: set par(first-line-indent: 0em)\n\
             #show figure: set par(first-line-indent: 0em)\n\
             #show outline: set par(first-line-indent: 0em)\n\
             #show outline.entry.where(level: 1): set text(font: {sans})\n\
             #show outline.entry.where(level: 1): set block(above: 1em)\n\
             #show raw: set text(font: {mono}, size: {inline_code}pt)\n\
             #show raw.where(block: false): it => highlight(fill: luma(238), radius: 2pt, extent: 1pt, it)\n\
             #show raw.where(block: true): set text(size: {code}pt)\n\
             #show raw.where(block: true): block.with(fill: luma(245), inset: 8pt, radius: 3pt, width: 100%)\n\
             #set table(stroke: {table_stroke}, inset: {inset}pt)\n\
             #let writer-three-line = (_, y) => (\n\
               top: if y == 0 {{ 1pt }} else {{ none }},\n\
               bottom: if y == 0 {{ 0.5pt }} else {{ none }},\n\
             )\n\
             #show table: set text(size: {table}pt)\n\
             #show table.cell.where(y: 0): set text(weight: \"bold\")\n\
             #set figure(numbering: none)\n\
             #show figure: set block(above: {figure}em, below: {figure}em)\n\
             #let writer-caption = (font: {caption_font}, size: {caption}pt)\n\
             #show figure.caption: set text(..writer-caption, fill: luma(100))\n\
             #show link: set text(fill: rgb(\"#1f4e9a\"))\n",
            inline_code = num(body.size * 0.9),
            inset = num(TABLE_INSET_PT),
            code = num(theme.code_block),
            table = num(theme.table),
            figure = num(theme.image_spacing),
            caption_font = font_list(theme.caption.font.into()),
            caption = num(theme.caption.size),
        ));
        self.out.push_str(&page_furniture(&layout, &title));

        let subtitle = document.subtitle.trim();
        let author = document.author.trim();
        let has_info = !document.title.trim().is_empty() || !subtitle.is_empty() || !author.is_empty();
        let info_font = font_list(theme.title.font.into());
        // 文档信息：标题、副标题、作者。封面上标题与副标题之间有一条细线，放在页面约 1/3 高处；
        // 不用封面时放在首页顶部，居中，下方留白后接目录或正文。
        let info_block = |cover: bool| {
            let mut out = String::from("#set par(first-line-indent: 0em, justify: false)\n#set align(center)\n");
            if cover {
                out.push_str("#v(28%)\n");
            }
            out.push_str(&format!(
                "#text(font: {info_font}, size: {}pt, weight: \"bold\")[#{title}]\n",
                num(theme.title.size),
            ));
            if cover {
                out.push_str("#v(1.5em)\n#line(length: 40%, stroke: 0.6pt + luma(120))\n");
            }
            if !subtitle.is_empty() {
                out.push_str(&format!(
                    "#v(1.2em)\n#text(font: {info_font}, size: {}pt, fill: luma(60))[#{}]\n",
                    num(COVER_SUBTITLE_PT * scale),
                    string(subtitle),
                ));
            }
            if !author.is_empty() {
                out.push_str(&format!(
                    "#v({})\n#text(font: {info_font}, size: {}pt, fill: luma(60))[#{}]\n",
                    if cover { "3em" } else { "1em" },
                    num(COVER_AUTHOR_PT * scale),
                    string(author),
                ));
            }
            out
        };
        let cover = layout.cover && has_info;
        let title_inline = !layout.cover && has_info;
        let has_toc = layout.toc && !document.sections.is_empty();
        // 双面装订：目录与正文从右页（奇数页）开始。
        let odd_page = if double { ODD_PAGE_BREAK } else { "" };
        if cover {
            self.out.push_str(&format!("#page[\n{}]\n", info_block(true)));
        }
        if has_toc {
            self.out.push_str(&format!(
                "{odd_page}#set page(numbering: \"i\", footer: writer-toc-footer)\n#counter(page).update(1)\n"
            ));
            if title_inline {
                self.out.push_str(&format!("#block(width: 100%, below: 2.5em)[\n{}]\n", info_block(false)));
            } else {
                self.out.push_str(&format!("#v({}pt)\n", num(CHAPTER_TOP_SPACE_PT)));
            }
            self.out.push_str(&format!("#outline(depth: {})\n", layout.toc_depth.get()));
        }
        if !document.sections.is_empty() {
            self.out.push_str(&format!(
                "{odd_page}#set page(numbering: \"1\", header: writer-header, footer: writer-body-footer)\n#counter(page).update(1)\n\n"
            ));
        }
        if title_inline && !has_toc {
            self.out.push_str(&format!("#block(width: 100%, below: 2.5em)[\n{}]\n", info_block(false)));
            self.title_block_before_body = true;
        }
        self.quote_font = font_list(theme.blockquote.font.into());
    }

    /// 章节编号在 PDF 中的写法（随排版配置）；不显示编号时为 None。标题与章节引用共用。
    fn number_text(&self, number: &str, depth: usize) -> Option<String> {
        match self.layout.chapter_number {
            _ if number.is_empty() => None,
            ChapterNumber::None => None,
            ChapterNumber::Chapter if depth <= 1 => Some(format!("第 {number} 章")),
            _ => Some(number.to_owned()),
        }
    }

    fn section(&mut self, section: &Section) {
        let depth = section.depth.max(1);
        let text = match self.number_text(&section.number, depth) {
            None => section.title.clone(),
            Some(number) => format!("{number} {}", section.title),
        };
        // 一级章节另起一页，上方留白；双面装订时从右页开始。页首的块间距会被丢弃，因此用固定留白。
        // 不用封面时，第一章紧接首页顶部的文档信息。
        if depth == 1 && self.layout.chapter_new_page && !self.title_block_before_body {
            let page_break = if self.layout.binding == Binding::Double {
                ODD_PAGE_BREAK
            } else {
                "#pagebreak(weak: true)\n"
            };
            self.out.push_str(&format!("{page_break}#v({}pt)\n", num(CHAPTER_TOP_SPACE_PT)));
        }
        self.title_block_before_body = false;
        // 标签供章节引用跳转（按章节序号命名，不受 id 中字符的限制）。
        let label = self
            .targets
            .by_id(&section.chapter_id)
            .map(|target| format!(" {}", chapter_label(target.index)))
            .unwrap_or_default();
        self.out.push_str(&format!("#heading(level: {depth})[#{}]{label}\n\n", string(&text)));
        for block in &section.blocks {
            let rendered = self.block(block, section);
            self.out.push_str(&rendered);
            self.out.push_str("\n\n");
        }
    }

    /// 公式的名称（`writer-math-<n>`，定义在源码开头）。
    fn formula(&mut self, tex: &str) -> String {
        let index = match self.formula_index.get(tex) {
            Some(index) => *index,
            None => {
                self.formulas.push((tex.to_owned(), math::to_typst(tex)));
                self.formula_index.insert(tex.to_owned(), self.formulas.len() - 1);
                self.formulas.len() - 1
            }
        };
        format!("writer-math-{index}")
    }

    /// 参考文献表（docs/decisions.md 第 13 节）：正文之后一个不编号的一级标题，按编号列出被引用的条目。
    fn bibliography(&mut self) {
        if self.citations.is_empty() {
            return;
        }
        if self.layout.chapter_new_page {
            let page_break = if self.layout.binding == Binding::Double { ODD_PAGE_BREAK } else { "#pagebreak(weak: true)\n" };
            self.out.push_str(&format!("{page_break}#v({}pt)\n", num(CHAPTER_TOP_SPACE_PT)));
        }
        self.out.push_str(&format!("#heading(level: 1)[#{}]\n\n", string(BIBLIOGRAPHY_TITLE)));
        let entries: Vec<String> = self
            .citations
            .list()
            .map(|(number, text)| {
                format!(
                    "#block(above: 0.5em, below: 0.5em)[#par(first-line-indent: 0em, hanging-indent: 2em)[#{}]] {}",
                    string(&breakable(&format!("[{number}] {text}"))),
                    citation_label(number)
                )
            })
            .collect();
        self.out.push_str(&entries.join("\n"));
        self.out.push_str("\n\n");
    }

    fn block(&mut self, block: &Block, section: &Section) -> String {
        // 独立的公式块：居中的行间公式。
        if let Some(tex) = block.as_math() {
            return format!("#math.equation(block: true, {})", self.formula(tex));
        }
        let element = self.elements.of(block).cloned();
        if let Some((src, alt)) = block.as_figure() {
            // 有编号的图：图注前是编号（“图 2-1　图注”），并带标签供图表引用跳转。
            let caption = match &element {
                Some(target) => format!("{}{ELEMENT_SEPARATOR}{alt}", target.label),
                None => alt.to_owned(),
            };
            let label = element.as_ref().map(|t| format!(" {}", element_label(t.anchor))).unwrap_or_default();
            // 图片无法显示时的占位文字仍用原来的图注。
            let image_alt = alt;
            let alt = caption.as_str();
            // 尺寸上限是完整正文区扣除图注及其间距，与图片落在页上的位置无关；
            // 图注高度在排版时按实际字体、宽度与折行测量，不做估算。
            // figure 不跨页拆分，当前页放不下时连同图注整体移到下一页。
            let text_width = self.page.text_width_pt();
            let text_height = self.page.text_height_pt();
            let mut max_height = format!("{}pt", num(text_height - IMAGE_HEIGHT_SLACK));
            if !alt.is_empty() {
                max_height = format!(
                    "{max_height} - {gap}pt - measure(block(width: size.width, text(..writer-caption)[#{caption}])).height",
                    gap = num(FIGURE_GAP_EM * self.theme.body.size),
                    caption = string(alt),
                );
            }
            let image = self.image(src, image_alt, text_width, &max_height);
            return if alt.is_empty() {
                format!("#figure({image}){label}")
            } else {
                format!("#figure({image}, caption: [#{}]){label}", string(alt))
            };
        }
        match block {
            Block::Paragraph(inlines) => self.inlines(inlines, &Container::text_area(&self.page)),
            Block::List { ordered, start, items } => {
                let items: Vec<String> = items.iter().map(|item| format!("[{}]", self.blocks(item, section))).collect();
                if *ordered {
                    format!("#enum(start: {start}, {})", items.join(", "))
                } else {
                    format!("#list({})", items.join(", "))
                }
            }
            Block::Quote(blocks) => {
                let content = self.blocks(blocks, section);
                format!(
                    "#block(inset: (left: 10pt, y: 2pt), stroke: (left: 2pt + luma(200)))[#set text(font: {}, size: {}pt, fill: luma(80))\n#set par(first-line-indent: 0em)\n{content}]",
                    self.quote_font,
                    num(self.theme.blockquote.size),
                )
            }
            Block::Code { language, text } => match language.as_deref().filter(|l| is_identifier(l)) {
                Some(language) => format!("#raw(block: true, lang: {}, {})", string(language), string(&breakable(text))),
                None => format!("#raw(block: true, {})", string(&breakable(text))),
            },
            Block::Structure { smiles, conditions } => self.structure(smiles, conditions),
            Block::Table { alignments, header, rows, spans, caption, note } => {
                // 表格标题在表格上方，与表格留在同一页；有编号时前面是编号并带标签。
                let title = match (caption, &element) {
                    (Some(caption), Some(target)) => {
                        format!(
                            "#block(sticky: true, width: 100%, below: 0.6em)[#align(center, text(..writer-caption)[#{}])] {}\n",
                            string(&format!("{}{ELEMENT_SEPARATOR}{}", target.label, caption.text)),
                            element_label(target.anchor),
                        )
                    }
                    _ => String::new(),
                };
                let table = self.table(alignments, header, rows, spans, note.as_deref());
                format!("{title}{table}")
            }
            Block::Rule => "#align(center, line(length: 30%, stroke: 0.5pt + luma(160)))".to_owned(),
        }
    }

    fn table(
        &mut self,
        alignments: &[Align],
        header: &Vec<Vec<Inline>>,
        rows: &[Vec<Vec<Inline>>],
        spans: &[CellSpan],
        note: Option<&str>,
    ) -> String {
        {
            {
                // 三线表 / 网格表（无图片时列宽随内容；含图片时各列等宽，见下）。
                let columns = header.len().max(rows.iter().map(Vec::len).max().unwrap_or(0)).max(1);
                let align: Vec<&str> = (0..columns)
                    .map(|i| match alignments.get(i) {
                        Some(Align::Center) => "center",
                        Some(Align::Right) => "right",
                        _ => "left",
                    })
                    .collect();
                let mut cells = Vec::new();
                // 没有图片的表格列宽由内容决定。含图片的表格各列等宽（与 Word 相同）：单元格中的图片
                // 不超过单元格宽度；含图片的行不能跨页拆开，而表头在每页重复，因此正文行中的图片不超过
                // 正文区减去表头高度与单元格上下内边距。表头高度在排版时按与最终表格相同的列宽、
                // 在表格实际所在容器的宽度下测量，折行与最终结果一致。
                // 合并的单元格（docs/decisions.md 第 23 节）：被合并的位置不输出，区域左上角是 table.cell，
                // 其中图片的宽度上限是所跨各列的宽度之和。
                let text_height = self.page.text_height_pt();
                let column_width = self.page.text_width_pt() / columns as f64;
                let cell_limit = num(text_height - 2.0 * TABLE_INSET_PT - IMAGE_HEIGHT_SLACK);
                // 表头在每页重复，其中的图片不超过正文区高度的四分之一（与 Word 相同），不能占满页面。
                let head_height = format!("{}pt", num(text_height / 4.0));
                let body_height = line_limit(&format!("{cell_limit}pt - writer-table-head"));
                let row = |writer: &mut Self, r: usize, row: &[Vec<Inline>], max_height: &str| -> Vec<String> {
                    (0..columns)
                        .filter_map(|i| {
                            let (cell, cols) = match cell_place(spans, r, i) {
                                CellPlace::Covered(_) => return None,
                                CellPlace::Origin(span) => (
                                    format!("table.cell(colspan: {}, rowspan: {})", span.cols, span.rows),
                                    span.cols,
                                ),
                                CellPlace::Single => (String::new(), 1),
                            };
                            let container = Container {
                                width: column_width * cols as f64 - 2.0 * TABLE_INSET_PT,
                                max_height: max_height.to_owned(),
                            };
                            let content = writer.inlines(row.get(i).map_or(&[][..], Vec::as_slice), &container);
                            Some(format!("{cell}[{content}]"))
                        })
                        .collect()
                };
                let head = row(self, 0, header, &head_height).join(", ");
                for (r, cells_of_row) in rows.iter().enumerate() {
                    cells.extend(row(self, r + 1, cells_of_row, &body_height));
                }
                let align = align.join(", ");
                let cells = cells.join(", ");
                let with_images = std::iter::once(header).chain(rows).flatten().any(|cell| has_image(cell));
                // 三线表：顶线、表头下的细线与底线；表头随跨页重复，顶线与表头线也随之重复。
                // 底线是最后一行之后的横线（不按单元格判断：跨行的单元格只按它的第一行判断，底线会断开）。
                // 网格表使用 preamble 中的统一描边。
                let stroke = match self.layout.table {
                    TableStyle::ThreeLine => ", stroke: writer-three-line",
                    TableStyle::Grid => "",
                };
                let cells = match self.layout.table {
                    TableStyle::ThreeLine if cells.is_empty() => "table.hline(stroke: 1pt)".to_owned(),
                    TableStyle::ThreeLine => format!("{cells}, table.hline(stroke: 1pt)"),
                    TableStyle::Grid => cells,
                };
                if !with_images && note.is_none() {
                    return format!("#table(columns: {columns}, align: ({align},){stroke}, table.header({head}), {cells})");
                }
                let table = |footer: &str| {
                    format!("table(columns: columns, align: ({align},){stroke}, table.header({head}), {cells}{footer})")
                };
                let mut lines = vec![if with_images {
                    format!("let columns = (1fr,) * {columns}")
                } else {
                    format!("let columns = {columns}")
                }];
                if with_images {
                    lines.push(format!(
                        "let writer-table-head = measure(block(width: size.width, table(columns: columns, align: ({align},), table.header({head})))).height"
                    ));
                }
                // 表注是不重复的表脚：在表格下方，与最后一行留在同一页。与表格标题一样按容器的全宽折行；
                // 外面是零宽的 box，表注不参与列宽的计算（否则会撑宽随内容的列），高度照常占用。
                let footer = note.map(|note| {
                    format!(
                        ", table.footer(repeat: false, table.cell(colspan: {columns}, align: left, stroke: none, inset: (x: 0pt, top: 0.5em, bottom: 0pt), box(width: 0pt, block(width: size.width, text(..writer-caption, fill: luma(100))[#{}]))))",
                        string(note)
                    )
                });
                lines.push(table(footer.as_deref().unwrap_or("")));
                format!("#layout(size => {{\n{}\n}})", lines.join("\n"))
            }
        }
    }

    fn blocks(&mut self, blocks: &[Block], section: &Section) -> String {
        blocks
            .iter()
            .map(|b| self.block(b, section))
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    /// 行内内容；container 给出其中图片的宽度与高度上限。
    fn inlines(&mut self, inlines: &[Inline], container: &Container) -> String {
        let mut out = String::new();
        for inline in inlines {
            match inline {
                Inline::Text(text) => {
                    out.push('#');
                    out.push_str(&string(&breakable(text)));
                }
                // 章节引用：按当前结构生成文字并链接到目标章节标题；失效引用输出链接文字（列入导出报告）。
                Inline::ChapterRef { target, cached } => match self.targets.get(target) {
                    Some(chapter) => {
                        let number = self.number_text(&chapter.number, chapter.depth);
                        let show = target.as_ref().map_or(RefShow::NumberTitle, |t| t.show);
                        let text = ref_text(number.as_deref(), &chapter.title, show);
                        out.push_str(&format!(
                            "#link({})[#{}]",
                            chapter_label(chapter.index),
                            string(&breakable(&text))
                        ));
                    }
                    None => {
                        out.push('#');
                        out.push_str(&string(&breakable(cached)));
                    }
                },
                // 文献引用：上标的“[编号]”，链接到参考文献表中的条目；条目不存在时输出链接文字（列入导出报告）。
                Inline::Citation { id, cached } => match self.citations.number(id) {
                    Some(number) => out.push_str(&format!(
                        "#super(typographic: false)[#link({})[#{}]]",
                        citation_label(number),
                        string(&format!("[{number}]"))
                    )),
                    None => {
                        out.push('#');
                        out.push_str(&string(&breakable(cached)));
                    }
                },
                // 图表引用：编号文字，链接到图表；失效引用输出链接文字（列入导出报告）。
                Inline::ElementRef { kind, id, cached } => match self.elements.get(*kind, id) {
                    Some(target) => out.push_str(&format!(
                        "#link({})[#{}]",
                        element_label(target.anchor),
                        string(&target.label)
                    )),
                    None => {
                        out.push('#');
                        out.push_str(&string(&breakable(cached)));
                    }
                },
                Inline::Strong(children) => {
                    out.push_str(&format!("#strong[{}]", self.inlines(children, container)))
                }
                Inline::Emphasis(children) => {
                    out.push_str(&format!("#emph[{}]", self.inlines(children, container)))
                }
                Inline::Strike(children) => {
                    out.push_str(&format!("#strike[{}]", self.inlines(children, container)))
                }
                // 上下标：与文献引用相同，不用字体自带的上下标字形（中文字体大多没有，同一段中会不一致）。
                Inline::Superscript(children) => out.push_str(&format!(
                    "#super(typographic: false)[{}]",
                    self.inlines(children, container)
                )),
                Inline::Subscript(children) => out.push_str(&format!(
                    "#sub(typographic: false)[{}]",
                    self.inlines(children, container)
                )),
                Inline::Code(code) => out.push_str(&format!("#raw({})", string(&breakable(code)))),
                Inline::Link { url, children } => {
                    let content = self.inlines(children, container);
                    if is_safe_url(url) {
                        out.push_str(&format!("#link({})[{content}]", string(url)));
                    } else {
                        out.push_str(&content);
                    }
                }
                Inline::Image { src, alt, .. } => {
                    // 与文字同段的图片（含表格单元格中的）：不超过所在容器的宽度与高度上限。
                    let image = self.image(src, alt, container.width, &container.max_height);
                    out.push_str(&format!("#box({image})"));
                }
                // 行内公式；段落中的行间公式（$$…$$）以行间样式排在行内。
                Inline::Math { tex, display } => {
                    let name = self.formula(tex);
                    let body = if *display { format!("math.display({name})") } else { name };
                    out.push_str(&format!("#math.equation(block: false, {body})"));
                }
                // 脚注：Typst 的 footnote 在页底按全文连续编号。
                Inline::Footnote(content) => {
                    out.push_str(&format!("#footnote[{}]", self.inlines(content, container)))
                }
                Inline::SoftBreak => out.push_str("#\" \""),
                Inline::HardBreak => out.push_str("#linebreak()"),
            }
        }
        out
    }

    /// 图片表达式；无法加载时返回红色占位文字并记入报告。
    /// 保持比例、不放大；宽度不超过 max_width 与排版时所在容器（列表、引用、表格单元格）的实际宽度，
    /// 高度不超过 max_height（Typst 长度表达式，可以引用排版时测得的尺寸与 layout 的 size）。
    /// 只给出宽度，高度按比例得到。
    fn image(&mut self, src: &str, alt: &str, max_width: f64, max_height: &str) -> String {
        // 每个引用仍先经过路径安全检查，避免缓存绕过项目边界。
        let image = resolve_image(self.root, src).and_then(|path| {
            if let Some(image) = self.image_cache.get(&path) {
                return Some(*image);
            }
            let image = load_for_export(&path)?;
            let prepared = PreparedImage {
                index: self.images.len(),
                size_pt: image.size_pt,
                format: if image.bytes.starts_with(&[0xff, 0xd8]) {
                    "jpg"
                } else {
                    "png"
                },
            };
            self.images.push(Bytes::new(image.bytes));
            self.image_cache.insert(path, prepared);
            Some(prepared)
        });
        let Some(image) = image else {
            self.report.missing_images.push(src.to_owned());
            let label = if alt.is_empty() { src } else { alt };
            return format!(
                "text(fill: rgb(\"#b91c1c\"))[#{}]",
                string(&format!("[图片无法显示：{label}]"))
            );
        };
        let index = image.index;
        // 虚拟路径固定为 .png，格式显式指定，避免 Typst 按扩展名解码 JPEG。
        let format = image.format;
        let bounds = Bounds {
            width: max_width,
            height: f64::INFINITY,
        };
        let (width, height) = display_size_pt(image.size_pt, bounds);
        format!(
            // 不设最小宽度：极窄的长图宽度可以小于 1pt，高度上限优先（宽度由高度上限按比例反推）。
            "layout(size => image(\"/img/{index}.png\", format: \"{format}\", width: calc.max(0pt, calc.min({width:.2}pt, size.width, ({max_height}) * {ratio}))))",
            ratio = width / height,
        )
    }
}

impl Writer<'_> {
    /// 化学结构式（docs/decisions.md 第 22 节）：前端画好的图片，与没有图注的图片相同地居中排列，
    /// 不放大，宽度不超过正文区。没有图片时以红色的 SMILES 原文输出并列入报告。
    fn structure(&mut self, smiles: &str, conditions: &StructureConditions) -> String {
        let key = (smiles.to_owned(), conditions.clone());
        let Some(image) = self.structures.get(&key) else {
            self.report.invalid_structures.push(smiles.to_owned());
            return format!("#align(center, text(fill: rgb(\"#b91c1c\"), raw({})))", string(smiles));
        };
        let (width, height) = (image.width_pt, image.height_pt);
        let index = match self.structure_index.get(&key) {
            Some(&index) => index,
            None => {
                let index = self.images.len();
                self.images.push(Bytes::new(image.png.clone()));
                self.structure_index.insert(key, index);
                index
            }
        };
        let max_height = num(self.page.text_height_pt() - IMAGE_HEIGHT_SLACK);
        format!(
            "#figure(layout(size => image(\"/img/{index}.png\", format: \"png\", width: calc.max(0pt, calc.min({width:.2}pt, size.width, {max_height}pt * {ratio})))))",
            ratio = width / height,
        )
    }
}

/// 双面装订时换到下一个右页。为凑右页插入的空白页不显示页眉页码：前后各放一个标记，
/// 页眉页脚据此判断自己是否在空白页上（`writer-blank`）。
const ODD_PAGE_BREAK: &str = "#metadata(none) <writer-gap-start>\n#pagebreak(weak: true, to: \"odd\")\n#metadata(none) <writer-gap-end>\n";

/// 页眉与页脚（Typst 定义）。页眉位于页首，用原生的 before / after 选择器查找前后章节：
/// 在脚本中逐页遍历全部章节会让千章文档的排版慢数倍。
/// - 单面：页码居中；页眉左侧文档标题、右侧当前一级章节。
/// - 双面：页码在外侧；左页（偶数页）页眉是文档标题，右页（奇数页）是当前一级章节，都靠外侧。
/// - 一级章节另起一页时，每章首页不显示页眉。
fn page_furniture(layout: &PdfLayout, title: &str) -> String {
    let double = layout.binding == Binding::Double;
    let side = if double {
        "if calc.odd(here().page()) { right } else { left }"
    } else {
        "center"
    };
    let label = match layout.page_number {
        PageNumber::Plain => "counter(page).display()",
        PageNumber::Page => "[第 #counter(page).display() 页]",
        PageNumber::Total => "[#counter(page).display() / #counter(page).final().first()]",
    };
    // 空白页：处在一对换页标记之间（之前的开始标记多于结束标记），最近的开始标记在更早的页上
    // （同一页上的开始标记跟在该页内容之后），下一个结束标记在更晚的页上。
    let mut out = String::from(
        "#let writer-blank() = {\n\
           let page = here().page()\n\
           let starts = query(selector(<writer-gap-start>).before(here()))\n\
           let ends = query(selector(<writer-gap-end>).before(here())).len()\n\
           let next = query(selector(<writer-gap-end>).after(here()))\n\
           (starts.len() > ends and starts.last().location().page() < page\n\
             and next.len() > 0 and next.first().location().page() > page)\n\
         }\n",
    );
    out.push_str(&format!(
        "#let writer-page-label(body) = context if not writer-blank() {{ align({side}, text(size: {meta}pt, fill: luma(100), body)) }}\n\
         #let writer-toc-footer = writer-page-label(context counter(page).display(\"i\"))\n\
         #let writer-body-footer = writer-page-label(context {label})\n",
        meta = num(META_TEXT_PT),
    ));
    let sides = match (layout.header, double) {
        (Header::None, _) => {
            out.push_str("#let writer-header = none\n");
            return out;
        }
        (Header::Title, false) => format!("([#{title}], none)"),
        (Header::TitleAndChapter, false) => format!("([#{title}], chapter)"),
        (Header::Title, true) => format!("if calc.odd(here().page()) {{ (none, [#{title}]) }} else {{ ([#{title}], none) }}"),
        (Header::TitleAndChapter, true) => {
            format!("if calc.odd(here().page()) {{ (none, chapter) }} else {{ ([#{title}], none) }}")
        }
    };
    let chapter_page = if layout.chapter_new_page {
        "{ let next = query(selector(chapters).after(here())); next.len() > 0 and next.first().location().page() == here().page() }"
    } else {
        "false"
    };
    out.push_str(&format!(
        "#let writer-header = context {{\n\
           let chapters = heading.where(level: 1, outlined: true)\n\
           if not {chapter_page} and not writer-blank() {{\n\
             let before = query(selector(chapters).before(here()))\n\
             let chapter = if before.len() > 0 {{ before.last().body }}\n\
             let (left-side, right-side) = {sides}\n\
             set text(size: {meta}pt, fill: luma(100))\n\
             set par(first-line-indent: 0em, justify: false)\n\
             block(width: 100%, inset: (bottom: 4pt), stroke: (bottom: 0.4pt + luma(160)),\n\
               grid(columns: (1fr, 1fr), gutter: 1em, align(left, left-side), align(right, right-side)))\n\
           }}\n\
         }}\n",
        meta = num(META_TEXT_PT),
    ));
    out
}

fn has_image(inlines: &[Inline]) -> bool {
    inlines.iter().any(|inline| match inline {
        Inline::Image { .. } => true,
        Inline::Strong(c)
        | Inline::Emphasis(c)
        | Inline::Strike(c)
        | Inline::Superscript(c)
        | Inline::Subscript(c) => has_image(c),
        Inline::Link { children, .. } => has_image(children),
        _ => false,
    })
}

/// Typst 数值字面量：最多保留两位小数（输出参数都是有限值）。
fn num(value: f64) -> String {
    let text = format!("{value:.2}");
    text.trim_end_matches('0').trim_end_matches('.').to_owned()
}

/// 超过这个长度的连续无法断行的字符串（URL、路径、标识符）允许在任意字符间断行。
const MAX_UNBREAKABLE_RUN: usize = 24;

/// 相当于 CSS overflow-wrap: anywhere：Typst 没有这个选项，过长的字符串会超出页面右边界。
/// 在这类字符串的字符之间插入零宽空格作为断行机会；每个字符都可断，两端对齐时行尾不会留下大段空白。
/// 普通单词与中文（本来就可以在字间断行）不受影响。
fn breakable(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    let mut run: Vec<char> = Vec::new();
    let flush = |run: &mut Vec<char>, out: &mut String| {
        if run.len() > MAX_UNBREAKABLE_RUN {
            for (i, c) in run.iter().enumerate() {
                if i > 0 {
                    out.push('\u{200B}');
                }
                out.push(*c);
            }
        } else {
            out.extend(run.iter());
        }
        run.clear();
    };
    for c in text.chars() {
        // 中文与全角标点本来就可以在字间断行。
        if c.is_whitespace() || is_cjk(c) || matches!(c, '\u{3000}'..='\u{303F}' | '\u{FF00}'..='\u{FFEF}') {
            flush(&mut run, &mut out);
            out.push(c);
        } else {
            run.push(c);
        }
    }
    flush(&mut run, &mut out);
    out
}

/// Typst 字符串字面量：转义反斜杠、引号与换行，去掉其余控制字符。
/// 图表编号与图注 / 标题之间的分隔（全角空格）。
const ELEMENT_SEPARATOR: &str = "\u{3000}";

/// 参考文献表的标题（输出中的文字）。
const BIBLIOGRAPHY_TITLE: &str = "参考文献";

/// 参考文献条目的标签（文献引用的跳转目标）。
fn citation_label(number: usize) -> String {
    format!("<writer-cite-{number}>")
}

/// 有编号的图表的标签（图表引用的跳转目标）。
fn element_label(anchor: usize) -> String {
    format!("<writer-element-{anchor}>")
}

/// 章节标题的标签（章节引用的跳转目标）。
fn chapter_label(index: usize) -> String {
    format!("<writer-chapter-{index}>")
}

fn string(text: &str) -> String {
    let mut out = String::with_capacity(text.len() + 2);
    out.push('"');
    for c in text.chars() {
        match c {
            '\\' => out.push_str("\\\\"),
            '"' => out.push_str("\\\""),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            c if c.is_control() => {}
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn is_identifier(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= 32
        && text
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || matches!(c, '-' | '_' | '+' | '#'))
}

fn is_safe_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")
}

pub(crate) struct PdfWorld {
    library: LazyHash<Library>,
    fonts: &'static FontStore,
    pub(crate) main: Source,
    images: Vec<(FileId, Bytes)>,
    /// 公式的 mitex 规格（`export::math::SCOPE_FILES`）。
    scope: Vec<Source>,
}

fn file_id(path: &str) -> FileId {
    let vpath = VirtualPath::new(path).expect("static virtual paths are valid");
    RootedPath::new(VirtualRoot::Project, vpath).intern()
}

impl PdfWorld {
    pub(crate) fn new(source: String, images: Vec<Bytes>, fonts: &'static FontStore) -> Self {
        let images = images
            .into_iter()
            .enumerate()
            .map(|(i, bytes)| (file_id(&format!("/img/{i}.png")), bytes))
            .collect();
        PdfWorld {
            library: LazyHash::new(Library::builder().build()),
            fonts,
            main: Source::new(file_id("/main.typ"), source),
            images,
            scope: math::SCOPE_FILES
                .iter()
                .map(|(path, text)| Source::new(file_id(path), (*text).to_owned()))
                .collect(),
        }
    }
}

impl World for PdfWorld {
    fn library(&self) -> &LazyHash<Library> {
        &self.library
    }

    fn book(&self) -> &LazyHash<FontBook> {
        self.fonts.book()
    }

    fn main(&self) -> FileId {
        self.main.id()
    }

    fn source(&self, id: FileId) -> FileResult<Source> {
        if id == self.main.id() {
            return Ok(self.main.clone());
        }
        self.scope
            .iter()
            .find(|source| source.id() == id)
            .cloned()
            .ok_or(FileError::NotSource)
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if id == self.main.id() {
            return Ok(Bytes::from_string(self.main.clone()));
        }
        if let Some(source) = self.scope.iter().find(|source| source.id() == id) {
            return Ok(Bytes::from_string(source.clone()));
        }
        self.images
            .iter()
            .find(|(image_id, _)| *image_id == id)
            .map(|(_, bytes)| bytes.clone())
            .ok_or_else(|| FileError::NotFound(PathBuf::from("image")))
    }

    fn font(&self, index: usize) -> Option<Font> {
        self.fonts.font(index)
    }

    fn today(&self, _offset: Option<Duration>) -> Option<Datetime> {
        None
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::images::tests::write_image;
    use crate::render::{build, RenderChapter, RenderRequest};
    use image::ImageFormat;
    use std::fs;
    use tempfile::TempDir;

    fn request(title: &str, chapters: &[(&str, Vec<u32>, &str, &str)]) -> RenderRequest {
        RenderRequest {
            title: title.into(),
            chapters: chapters
                .iter()
                .map(|(id, number, title, markdown)| RenderChapter {
                    id: (*id).into(),
                    number: number.clone(),
                    title: (*title).into(),
                    markdown: (*markdown).into(),
                })
                .collect(),
            ..Default::default()
        }
    }

    fn project() -> TempDir {
        let dir = TempDir::new().unwrap();
        fs::create_dir_all(dir.path().join("content")).unwrap();
        fs::create_dir_all(dir.path().join("assets")).unwrap();
        dir
    }

    fn system_fonts() -> &'static FontStore {
        font_store(None)
    }

    fn page_count(pdf: &[u8]) -> usize {
        let text = String::from_utf8_lossy(pdf);
        text.matches("/Type /Page\n").count()
            + text.matches("/Type /Page ").count()
            + text.matches("/Type/Page/").count()
    }

    fn test_writer(root: &Path) -> Writer<'_> {
        Writer::new(root, &PdfLayout::default())
    }

    /// 默认 A4、四边 25mm 的正文区（160mm × 247mm）。
    const TEXT_WIDTH_PT: f64 = 160.0 / 25.4 * 72.0;
    const TEXT_HEIGHT_PT: f64 = 247.0 / 25.4 * 72.0;

    #[test]
    fn repeated_images_share_bytes_but_keep_each_containers_size() {
        let dir = project();
        write_image(
            &dir.path().join("assets/wide.png"),
            1200,
            600,
            ImageFormat::Png,
        );
        let mut writer = test_writer(dir.path());
        let wide = writer.image("../assets/wide.png", "First", 400.0, "600pt");
        // 不同引用文本解析为同一安全路径；尺寸仍由每次出现的容器决定。
        let narrow = writer.image("../assets/%77ide.png", "Second", 100.0, "200pt");
        assert_eq!(writer.images.len(), 1, "同一文件只准备一次");
        assert!(wide.contains("/img/0.png") && narrow.contains("/img/0.png"));
        assert!(wide.contains("400.00pt") && narrow.contains("100.00pt"));
        assert!(wide.contains("600pt") && narrow.contains("200pt"));
        assert!(writer.report.missing_images.is_empty());
    }

    #[test]
    fn image_reuse_does_not_keep_stale_files_across_exports() {
        let dir = project();
        let path = dir.path().join("assets/small.png");
        let document = build(&request(
            "",
            &[(
                "a",
                vec![1],
                "",
                "![First](../assets/small.png)\n\n![Second](../assets/small.png)",
            )],
        ));
        write_image(&path, 80, 40, ImageFormat::Png);
        let (first, report) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        assert!(report.missing_images.is_empty());
        let first_images = images(&first);
        assert_eq!(first_images.len(), 2);
        assert!(first_images
            .iter()
            .all(|image| (image.3 - 60.0).abs() < 0.1 && (image.4 - 30.0).abs() < 0.1));
        write_image(&path, 160, 80, ImageFormat::Png);
        let (second, report) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        assert!(report.missing_images.is_empty());
        let second_images = images(&second);
        assert_eq!(second_images.len(), 2);
        assert!(second_images
            .iter()
            .all(|image| (image.3 - 120.0).abs() < 0.1 && (image.4 - 60.0).abs() < 0.1));
        fs::write(&path, b"broken image").unwrap();
        let (broken, report) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        assert!(images(&broken).is_empty());
        assert_eq!(
            report.missing_images,
            vec!["../assets/small.png", "../assets/small.png"]
        );
    }

    #[test]
    fn image_reuse_preserves_layout_in_figures_quotes_and_tables() {
        let dir = project();
        for (extension, format) in [("png", ImageFormat::Png), ("jpg", ImageFormat::Jpeg)] {
            let first = format!("../assets/first.{extension}");
            let second = format!("../assets/second.{extension}");
            let third = format!("../assets/third.{extension}");
            let source = dir.path().join(format!("assets/first.{extension}"));
            write_image(&source, 1200, 600, format);
            fs::copy(
                &source,
                dir.path().join(format!("assets/second.{extension}")),
            )
            .unwrap();
            fs::copy(
                &source,
                dir.path().join(format!("assets/third.{extension}")),
            )
            .unwrap();
            let document = |quote: &str, table: &str| {
                build(&request("", &[("a", vec![1], "Images", &format!(
                    "![Figure]({first})\n\n> ![Quote]({quote})\n\n| Image | Description |\n| --- | --- |\n| ![Table]({table}) | Text |"
                ))]))
            };
            // 三个不同文件强制分别准备，作为相同内容的参照排版。
            let (reference, _) =
                layout(&document(&second, &third), dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
            let (reused, report) =
                layout(&document(&first, &first), dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
            assert!(report.missing_images.is_empty());
            assert_eq!(images(&reused).len(), 3);
            assert_eq!(reused.pages().len(), reference.pages().len());
            assert_eq!(placed(&reused), placed(&reference));
        }
    }

    /// 对比纯文字、JPEG、PNG、混合与重复图片。仅使用临时测试数据，字体库预热不计时。
    /// `cargo test --lib measure_pdf_image_formats -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn measure_pdf_image_formats() {
        let dir = project();
        let fonts = system_fonts();
        let mut seed = 7u32;
        for n in 0..6 {
            let photo = image::RgbImage::from_fn(1200, 800, |_, _| {
                let mut next = || {
                    seed ^= seed << 13;
                    seed ^= seed >> 17;
                    seed ^= seed << 5;
                    seed as u8
                };
                image::Rgb([next(), next(), next()])
            });
            photo
                .save(dir.path().join(format!("assets/{n}.jpg")))
                .unwrap();
            write_image(
                &dir.path().join(format!("assets/{n}.png")),
                1200,
                800,
                ImageFormat::Png,
            );
        }
        for case in ["text", "jpeg", "png", "mixed", "repeated"] {
            let count = if case == "repeated" { 24 } else { 6 };
            let markdown = (0..count)
                .map(|n| {
                    let index = if case == "repeated" { 0 } else { n };
                    let format = if case == "png" || (case == "mixed" && n % 2 == 0) {
                        "png"
                    } else {
                        "jpg"
                    };
                    if case == "text" {
                        "测试正文。".to_owned()
                    } else {
                        format!("测试正文。\n\n![测试图片](../assets/{index}.{format})")
                    }
                })
                .collect::<Vec<_>>()
                .join("\n\n");
            let document = build(&request(
                "图片编码测试",
                &[("a", vec![1], "测试", &markdown)],
            ));
            let started = std::time::Instant::now();
            let (word, report) = crate::export::docx::export(&document, dir.path()).unwrap();
            let word_time = started.elapsed();
            assert!(report.missing_images.is_empty());
            let mut archive = zip::ZipArchive::new(std::io::Cursor::new(&word)).unwrap();
            let mut media_bytes = 0;
            for n in 0..archive.len() {
                let part = archive.by_index(n).unwrap();
                if part.name().starts_with("word/media/") {
                    media_bytes += part.size();
                }
            }
            let started = std::time::Instant::now();
            let mut writer = test_writer(dir.path());
            writer.preamble(&document, fonts.book());
            for section in &document.sections {
                writer.section(section);
            }
            let prep_time = started.elapsed();
            let prepared_count = writer.images.len();
            let prepared_bytes: usize = writer.images.iter().map(|b| b.len()).sum();
            assert!(writer.report.missing_images.is_empty());
            let world = PdfWorld::new(writer.out, writer.images, fonts);
            let started = std::time::Instant::now();
            let paged = typst::compile::<PagedDocument>(&world).output.unwrap();
            let layout_time = started.elapsed();
            let started = std::time::Instant::now();
            let pdf = typst_pdf::pdf(&paged, &Default::default()).unwrap();
            println!("{case}: Word={} bytes ({word_time:?}), media={media_bytes}; PDF={} bytes, prepared={prepared_count}/{prepared_bytes} bytes, prep={prep_time:?}, layout={layout_time:?}, encode={:?}, pages={}", word.len(), pdf.len(), started.elapsed(), paged.pages().len());
            // 可选：保留输出用于外部阅读器核对，目录由调用者指定为测试目录。
            if let Ok(out) = std::env::var("WRITER_SAMPLE_DIR") {
                fs::write(Path::new(&out).join(format!("{case}.pdf")), &pdf).unwrap();
            }
            comemo::evict(0);
        }
    }

    /// 24 张 JPEG（约 29 MB）与正文的分阶段基准，不计 fixture 生成与字体库预热。
    /// `cargo test --lib measure_image_pdf_export -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn measure_image_pdf_export() {
        let dir = project();
        let mut chapters = Vec::new();
        let mut seed = 7u32;
        let fonts = system_fonts();
        let mut image_bytes = 0;
        for n in 1..=24 {
            let path = dir.path().join(format!("assets/photo-{n}.jpg"));
            let image = image::RgbImage::from_fn(1200, 800, |_, _| {
                let mut next = || {
                    seed ^= seed << 13;
                    seed ^= seed >> 17;
                    seed ^= seed << 5;
                    seed as u8
                };
                image::Rgb([next(), next(), next()])
            });
            image.save_with_format(&path, ImageFormat::Jpeg).unwrap();
            image_bytes += fs::metadata(&path).unwrap().len();
            chapters.push(RenderChapter {
                id: format!("{n}"),
                number: vec![n],
                title: format!("第 {n} 章"),
                markdown: format!(
                    "{}\n\n![照片](../assets/photo-{n}.jpg)",
                    vec!["长文档写作需要清晰的结构与稳定的输出。".repeat(20); 5].join("\n\n")
                ),
            });
        }
        let document = build(&RenderRequest {
            title: "图文性能测试".into(),
            chapters,
            ..Default::default()
        });
        let started = std::time::Instant::now();
        let (word, report) = crate::export::docx::export(&document, dir.path()).unwrap();
        println!("Word export: {:?}, {} bytes", started.elapsed(), word.len());
        assert!(report.missing_images.is_empty());
        let mut writer = Writer::new(dir.path(), &PdfLayout::default());
        let started = std::time::Instant::now();
        writer.preamble(&document, fonts.book());
        for section in &document.sections {
            writer.section(section);
        }
        println!(
            "image preparation: {:?}, {} source bytes",
            started.elapsed(),
            image_bytes
        );
        let world = PdfWorld::new(writer.out, writer.images, fonts);
        let started = std::time::Instant::now();
        let paged = typst::compile::<PagedDocument>(&world).output.unwrap();
        println!(
            "image layout: {:?}, {} pages",
            started.elapsed(),
            paged.pages().len()
        );
        let started = std::time::Instant::now();
        let bytes = typst_pdf::pdf(&paged, &Default::default()).unwrap();
        println!(
            "image PDF encoding: {:?}, {} bytes",
            started.elapsed(),
            bytes.len()
        );
        assert!(writer.report.missing_images.is_empty());
        comemo::evict(0);
    }

    #[test]
    #[ignore]
    fn measure_text_pdf_export() {
        let dir = project();
        let body = vec!["长文档写作需要清晰的结构与稳定的输出。".repeat(20); 5]
            .join("\n\n");
        let document = build(&RenderRequest {
            title: "性能测试".into(),
            chapters: (1..=50)
                .map(|n| RenderChapter {
                    id: format!("{n}"),
                    number: vec![n],
                    title: format!("第 {n} 章"),
                    markdown: body.clone(),
                })
                .collect(),
            ..Default::default()
        });
        let fonts = system_fonts();
        let started = std::time::Instant::now();
        let (paged, _) = layout(&document, dir.path(), fonts, &PdfLayout::default()).unwrap();
        println!(
            "text layout: {:?}, {} pages",
            started.elapsed(),
            paged.pages().len()
        );
        for tagged in [true, false] {
            let started = std::time::Instant::now();
            let options = typst_pdf::PdfOptions {
                tagged,
                ..Default::default()
            };
            let bytes = typst_pdf::pdf(&paged, &options).unwrap();
            println!(
                "text PDF tagged={tagged}: {:?}, {} bytes",
                started.elapsed(),
                bytes.len()
            );
        }
        comemo::evict(0);
    }

    #[test]
    fn jpeg_is_embedded_without_png_conversion() {
        let dir = project();
        let path = dir.path().join("assets/photo.jpg");
        // 照片类纹理：解码后再无损压缩会比原 JPEG 大很多。
        let mut seed = 7u32;
        let image = image::RgbImage::from_fn(1200, 800, |_, _| {
            let mut next = || {
                seed ^= seed << 13;
                seed ^= seed >> 17;
                seed ^= seed << 5;
                seed as u8
            };
            image::Rgb([next(), next(), next()])
        });
        image.save_with_format(&path, ImageFormat::Jpeg).unwrap();
        let jpeg = fs::read(&path).unwrap();
        let document = build(&request(
            "",
            &[("a", vec![1], "Photo", "![Photo](../assets/photo.jpg)")],
        ));
        let started = std::time::Instant::now();
        let (pdf, report) = export(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        println!(
            "JPEG PDF: {:?}, {} bytes (source: {})",
            started.elapsed(),
            pdf.len(),
            jpeg.len()
        );
        assert!(report.missing_images.is_empty());
        assert!(pdf.windows(jpeg.len()).any(|bytes| bytes == jpeg));
        assert!(pdf.len() < jpeg.len() + 100_000);
    }

    #[test]
    fn png_uses_lossless_row_prediction_instead_of_expanding_pixels() {
        let dir = project();
        let path = dir.path().join("assets/gradient.png");
        write_image(&path, 1200, 800, ImageFormat::Png);
        let document = build(&request(
            "",
            &[("a", vec![1], "", "![](../assets/gradient.png)")],
        ));
        let (pdf, report) = export(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        assert!(report.missing_images.is_empty());
        assert!(pdf.len() < fs::metadata(path).unwrap().len() as usize + 100_000);
        let text = String::from_utf8_lossy(&pdf);
        assert!(text.contains("/Predictor 15"));
        assert!(text.contains("/Colors 3") && text.contains("/Columns 1200"));
    }

    #[test]
    fn transparent_png_predicts_both_color_and_soft_mask() {
        let dir = project();
        image::RgbaImage::from_fn(80, 40, |x, y| {
            image::Rgba([x as u8, y as u8, 128, ((x + y) % 256) as u8])
        })
        .save(dir.path().join("assets/alpha.png"))
        .unwrap();
        let document = build(&request(
            "",
            &[("a", vec![1], "", "![](../assets/alpha.png)")],
        ));
        let (pdf, report) = export(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        assert!(report.missing_images.is_empty());
        let text = String::from_utf8_lossy(&pdf);
        assert_eq!(text.matches("/Predictor 15").count(), 2);
        assert!(text.contains("/Colors 1") && text.contains("/Colors 3"));
        assert!(text.contains("/SMask"));
    }

    #[test]
    fn full_document_compiles_to_pdf() {
        let dir = project();
        write_image(
            &dir.path().join("assets/图.png"),
            800,
            400,
            ImageFormat::Png,
        );
        let markdown = "**粗体**、*斜体*、~~删除~~、`code`、[链接](https://example.com)、m<sup>3</sup>、H<sub>2</sub>O\n\n\
                        - 甲\n  1. 子一\n  2. 子二\n- 乙\n\n3. 三\n4. 四\n\n> 引用\n> > 嵌套\n\n\
                        ```rust\nfn main() {}\n```\n\n| 组别 | 数 |\n| :-: | --: |\n| 对照 | 30 |\n\n---\n\n\
                        ![示意图](../assets/图.png)\n\n![丢失](../assets/无.png)\n\n## 小节\n\n中文段落\n折行。";
        let document = build(&request(
            "示例论文",
            &[
                ("a", vec![1], "绪论", markdown),
                ("b", vec![1, 1], "背景", ""),
            ],
        ));
        let (pdf, report) = export(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        assert!(pdf.starts_with(b"%PDF-"));
        assert_eq!(report.missing_images, vec!["../assets/无.png"]);
    }

    #[test]
    fn long_unbroken_strings_get_break_opportunities() {
        let url = format!("https://example.com/{}", "a".repeat(60));
        let broken = breakable(&url);
        assert_eq!(broken.replace('\u{200B}', ""), url);
        assert!(broken.split('\u{200B}').all(|part| part.chars().count() == 1));
        let word = "a".repeat(MAX_UNBREAKABLE_RUN);
        assert_eq!(breakable(&word), word);
        // 普通文字与中文不变。
        for text in ["普通的英文 words and 中文段落没有多余字符", "中文".repeat(100).as_str()] {
            assert_eq!(breakable(text), text);
        }
    }

    #[test]
    fn long_url_stays_inside_the_text_area() {
        let dir = project();
        let url = format!("https://example.com/{}", "a".repeat(200));
        let markdown = format!("地址：{url}\n\n`{url}`\n\n```\n{url}\n```");
        let document = build(&request("", &[("a", vec![1], "链接", &markdown)]));
        let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        let page_width = paged.pages()[0].frame.width().to_pt();
        let right_margin = 25.0 / 25.4 * 72.0;
        let mut texts = 0;
        for page in paged.pages() {
            for_each_text_right_edge(&page.frame, typst::layout::Point::zero(), &mut |x| {
                texts += 1;
                assert!(
                    x <= page_width - right_margin + 0.5,
                    "text ends at x={x}, past the right margin"
                );
            });
        }
        assert!(texts > 0);
    }

    /// 遍历分页结果中每段文字的右边界（磅）。
    fn for_each_text_right_edge(
        frame: &typst::layout::Frame,
        offset: typst::layout::Point,
        visit: &mut impl FnMut(f64),
    ) {
        use typst::layout::FrameItem;
        for (position, item) in frame.items() {
            let at = offset + *position;
            match item {
                FrameItem::Group(group) => for_each_text_right_edge(&group.frame, at, visit),
                FrameItem::Text(text) => visit((at.x + text.width()).to_pt()),
                _ => {}
            }
        }
    }

    /// 分页结果中的文字与图片（页面坐标，磅）。
    #[derive(Debug, PartialEq)]
    enum Placed {
        Text {
            page: usize,
            x: f64,
            y: f64,
            size: f64,
            family: String,
            text: String,
        },
        Image {
            page: usize,
            x: f64,
            y: f64,
            width: f64,
            height: f64,
        },
    }

    fn placed(paged: &PagedDocument) -> Vec<Placed> {
        fn walk(
            page: usize,
            frame: &typst::layout::Frame,
            offset: typst::layout::Point,
            out: &mut Vec<Placed>,
        ) {
            use typst::layout::FrameItem;
            for (position, item) in frame.items() {
                let at = offset + *position;
                match item {
                    FrameItem::Group(group) => walk(page, &group.frame, at, out),
                    FrameItem::Text(text) => out.push(Placed::Text {
                        page,
                        x: at.x.to_pt(),
                        y: at.y.to_pt(),
                        size: text.size.to_pt(),
                        family: text.font.info().family.to_lowercase(),
                        text: text.text.to_string(),
                    }),
                    FrameItem::Image(_, size, _) => out.push(Placed::Image {
                        page,
                        x: at.x.to_pt(),
                        y: at.y.to_pt(),
                        width: size.x.to_pt(),
                        height: size.y.to_pt(),
                    }),
                    _ => {}
                }
            }
        }
        let mut out = Vec::new();
        for (page, p) in paged.pages().iter().enumerate() {
            walk(page, &p.frame, typst::layout::Point::zero(), &mut out);
        }
        out
    }

    /// 图片：(页, x, y, 宽, 高)。
    fn images(paged: &PagedDocument) -> Vec<(usize, f64, f64, f64, f64)> {
        placed(paged)
            .into_iter()
            .filter_map(|p| match p {
                Placed::Image {
                    page,
                    x,
                    y,
                    width,
                    height,
                } => Some((page, x, y, width, height)),
                _ => None,
            })
            .collect()
    }

    const MARGIN_PT: f64 = 25.0 / 25.4 * 72.0;

    fn in_family(font: &str, family: FontFamily) -> bool {
        families(family)
            .iter()
            .any(|name| name.to_lowercase() == font)
    }

    #[test]
    fn default_output_fonts_sizes_and_line_pitch() {
        let dir = project();
        let request = request(
            "",
            &[("a", vec![1], "标题甲", &"正文段落用于测量行距。".repeat(40))],
        );
        let (paged, _) = layout(&build(&request), dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        let items = placed(&paged);

        let heading: Vec<_> = items
            .iter()
            .filter_map(|p| match p {
                // 第 0 页是目录，其中的条目也包含章节标题。
                Placed::Text {
                    page, size, family, text, ..
                } if *page > 0 && text.contains("标题甲") => Some((*size, family.clone())),
                _ => None,
            })
            .collect();
        assert!(!heading.is_empty());
        for (size, family) in &heading {
            assert_eq!(*size, 18.0);
            assert!(in_family(family, FontFamily::Sans), "heading font {family}");
        }

        let mut body_lines: Vec<f64> = items
            .iter()
            .filter_map(|p| match p {
                Placed::Text {
                    y,
                    size,
                    family,
                    text,
                    ..
                } if text.contains("正文") => {
                    assert_eq!(*size, 12.0);
                    assert!(in_family(family, FontFamily::Serif), "body font {family}");
                    Some(*y)
                }
                _ => None,
            })
            .collect();
        body_lines.dedup_by(|a, b| (*a - *b).abs() < 0.01);
        assert!(body_lines.len() >= 3, "paragraph should wrap");
        for pair in body_lines.windows(2) {
            // 相邻基线距离 = 字号 × 行距倍数（12 × 1.75）。
            assert!(
                (pair[1] - pair[0] - 21.0).abs() < 0.05,
                "line pitch {}",
                pair[1] - pair[0]
            );
        }
    }

    /// 每页的文字（按排版顺序拼接）。
    fn page_texts(paged: &PagedDocument) -> Vec<String> {
        let mut pages = vec![String::new(); paged.pages().len()];
        for item in placed(paged) {
            if let Placed::Text { page, text, .. } = item {
                pages[page].push_str(&text);
            }
        }
        pages
    }

    #[test]
    fn preview_renders_at_most_the_first_pages_as_svg() {
        use crate::export::pdf_layout::Paper;
        let dir = project();
        let long = "很长的正文用于跨页。".repeat(3000);
        let document = build(&request("样张", &[("a", vec![1], "第一章节", &long)]));
        let layout = PdfLayout { paper: Paper::A5, ..PdfLayout::default() };
        let pages = preview(&document, dir.path(), system_fonts(), &layout).unwrap();
        assert_eq!(pages.len(), PREVIEW_MAX_PAGES);
        // A5：148mm × 210mm。
        assert!(pages[0].starts_with("<svg") && pages[0].contains("viewBox=\"0 0 419.5"), "{}", &pages[0][..200]);
    }

    #[test]
    fn cover_contents_and_chapters_each_start_a_page() {
        let dir = project();
        let long = "很长的正文用于跨页。".repeat(400);
        let document = build(&request(
            "封面标题",
            &[
                ("a", vec![1], "第一章节", &long),
                ("b", vec![1, 1], "第一小节", "小节正文。"),
                ("c", vec![2], "第二章节", "第二章正文。"),
            ],
        ));
        let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        let texts = page_texts(&paged);
        // 封面：只有标题，没有页码。
        assert_eq!(texts[0], "封面标题");
        assert!(paged.pages()[0].numbering.is_none());
        // 目录：两级条目，页码使用罗马数字。
        assert!(texts[1].contains("目录") && texts[1].contains("1 第一章节") && texts[1].contains("1.1 第一小节"));
        assert!(texts[1].ends_with('i'), "{}", texts[1]);
        // 正文从第 1 页开始；章节首页没有页眉。
        assert!(texts[2].starts_with("1 第一章节"), "{}", texts[2]);
        assert_eq!(paged.pages()[2].number, 1);
        assert!(texts[2].ends_with('1'));
        // 章节的后续页：页眉包含文档标题与当前一级章节。
        assert!(texts[3].starts_with("封面标题1 第一章节"), "{}", texts[3]);
        // 第二章另起一页，小节不另起一页。
        let second = texts.iter().position(|t| t.contains("第二章节") && !t.contains("目录")).unwrap();
        assert!(texts[second].starts_with("2 第二章节"), "{}", texts[second]);
        assert!(!texts[second - 1].contains("第二章正文"));
        assert!(texts.iter().any(|t| t.contains("第一小节") && t.contains("很长的正文")));
    }

    #[test]
    fn cover_shows_subtitle_and_author_and_pdf_metadata_names_the_author() {
        let dir = project();
        let mut request = request("论文标题", &[("a", vec![1], "章", "正文。")]);
        request.subtitle = "一项研究".into();
        request.author = "张三".into();
        let document = build(&request);
        let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        assert_eq!(page_texts(&paged)[0], "论文标题一项研究张三");
        let sizes: Vec<(String, f64)> = placed(&paged)
            .into_iter()
            .filter_map(|p| match p {
                Placed::Text { page: 0, text, size, .. } => Some((text, size)),
                _ => None,
            })
            .collect();
        assert!(sizes.contains(&("一项研究".into(), 16.0)) && sizes.contains(&("张三".into(), 12.0)), "{sizes:?}");
        let info = typst::model::Document::info(&paged);
        assert_eq!(info.author, vec!["张三"]);
        assert_eq!(info.title.as_deref(), Some("论文标题"));
    }

    fn layout_with(document: &Document, pdf_layout: PdfLayout) -> PagedDocument {
        let dir = project();
        layout(document, dir.path(), system_fonts(), &pdf_layout).unwrap().0
    }

    /// 页面中指向文档内部位置（而不是网址）的链接数量。
    fn internal_links(paged: &PagedDocument) -> usize {
        fn walk(frame: &typst::layout::Frame) -> usize {
            use typst::layout::FrameItem;
            frame
                .items()
                .map(|(_, item)| match item {
                    FrameItem::Group(group) => walk(&group.frame),
                    FrameItem::Link(destination, _) => {
                        usize::from(!matches!(destination, typst::model::Destination::Url(_)))
                    }
                    _ => 0,
                })
                .sum()
        }
        paged.pages().iter().map(|page| walk(&page.frame)).sum()
    }

    #[test]
    fn chapter_references_follow_the_chapter_number_style_and_link_to_headings() {
        let markdown = "见[旧](writer:chapter/c)、[旧](writer:chapter/b?show=number)与[旧](writer:chapter/c?show=title)；\
                        失效：[原目标](writer:chapter/gone)、[坏地址](writer:chapter/)。";
        let document = build(&request(
            "",
            &[
                ("a", vec![1], "绪论", markdown),
                ("b", vec![1, 1], "背景", ""),
                ("c", vec![2], "方法", ""),
            ],
        ));
        let dir = project();
        let (paged, report) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        let text = page_texts(&paged).concat();
        assert!(text.contains("见2 方法、1.1与方法；失效：原目标、坏地址。"), "{text}");
        // 目录条目也是文档内链接：关闭目录后只剩三个有效引用。
        let no_toc = layout_with(&document, PdfLayout { toc: false, ..PdfLayout::default() });
        assert_eq!(internal_links(&no_toc), 3);
        assert_eq!(report.broken_references, vec!["原目标", "坏地址"]);

        let chapter = layout_with(&document, PdfLayout { chapter_number: ChapterNumber::Chapter, ..PdfLayout::default() });
        let text = page_texts(&chapter).concat();
        assert!(text.contains("见第 2 章 方法、1.1与方法"), "{text}");

        let hidden = layout_with(&document, PdfLayout { chapter_number: ChapterNumber::None, ..PdfLayout::default() });
        let text = page_texts(&hidden).concat();
        assert!(text.contains("见方法、背景与方法"), "{text}");
    }

    #[test]
    fn footnotes_are_placed_at_the_page_bottom_with_continuous_numbers() {
        let document = build(&request(
            "",
            &[
                ("a", vec![1], "绪论", "第一处[^a]正文。\n\n[^a]: 脚注甲"),
                ("b", vec![2], "方法", "第二处[^b]。\n\n[^b]: 脚注**乙**"),
            ],
        ));
        let paged = layout_with(&document, PdfLayout { toc: false, ..PdfLayout::default() });
        let texts = page_texts(&paged);
        // 正文中是上标编号，内容在同一页的底部；编号在全文中连续。
        let first = texts.iter().find(|t| t.contains("第一处")).unwrap();
        assert!(first.contains("第一处1正文") && first.contains("1脚注甲"), "{first}");
        let second = texts.iter().find(|t| t.contains("第二处")).unwrap();
        assert!(second.contains("第二处2") && second.contains("2脚注乙"), "{second}");
    }

    #[test]
    fn figures_and_tables_are_numbered_and_referenced() {
        let dir = project();
        let png = dir.path().join("assets/图.png");
        std::fs::create_dir_all(png.parent().unwrap()).unwrap();
        image::RgbImage::new(20, 10).save(&png).unwrap();
        let document = build(&request(
            "",
            &[
                ("a", vec![1], "绪论", "见[旧](writer:figure/f1)与[旧](writer:table/t1)，失效：[原图](writer:figure/gone)。"),
                ("b", vec![2], "方法", "![流程](../assets/图.png \"fig:f1\")\n\nTable: 样本 {#tbl:t1}\n\n| 组 |\n| - |\n| 甲 |"),
            ],
        ));
        let (paged, report) = layout(&document, dir.path(), system_fonts(), &PdfLayout { toc: false, ..PdfLayout::default() }).unwrap();
        let text = page_texts(&paged).concat();
        assert!(text.contains("见图 2-1与表 2-1，失效：原图。"), "{text}");
        assert!(text.contains("图 2-1\u{3000}流程") && text.contains("表 2-1\u{3000}样本"), "{text}");
        assert_eq!(internal_links(&paged), 2);
        assert_eq!(report.broken_references, vec!["原图"]);
    }

    #[test]
    fn citations_are_superscript_numbers_and_the_bibliography_follows_the_body() {
        let mut request = request(
            "",
            &[("a", vec![1], "绪论", "见[[x]](writer:cite/b)与[[y]](writer:cite/a)，再见[[z]](writer:cite/b)；失效[[旧]](writer:cite/gone)。")],
        );
        request.references = vec![
            crate::render::RenderReference { id: "a".into(), text: "甲. 书[M]. 2020.".into() },
            crate::render::RenderReference { id: "b".into(), text: "乙. 文[J]. 刊, 2021.".into() },
            crate::render::RenderReference { id: "c".into(), text: "未引用[M].".into() },
        ];
        let document = build(&request);
        let dir = project();
        let (paged, report) = layout(&document, dir.path(), system_fonts(), &PdfLayout { toc: false, ..PdfLayout::default() }).unwrap();
        let texts = page_texts(&paged);
        let text = texts.concat();
        assert!(text.contains("见[1]与[2]，再见[1]；失效[旧]。"), "{text}");
        let last = texts.last().unwrap();
        assert!(last.starts_with("参考文献[1] 乙. 文[J]. 刊, 2021.[2] 甲. 书[M]. 2020."), "{last}");
        assert!(!text.contains("未引用"));
        assert_eq!(internal_links(&paged), 3);
        assert_eq!(report.broken_references, vec!["[旧]"]);
    }

    #[test]
    fn superscript_and_subscript_are_typeset_in_place() {
        let document = build(&request("", &[("a", vec![1], "绪论", "流量 50 m<sup>3</sup>/d，H<sub>2</sub>O，x<sup>*n*</sup>。")]));
        let dir = project();
        let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout { toc: false, ..PdfLayout::default() }).unwrap();
        let text = page_texts(&paged).concat();
        assert!(text.contains("流量 50 m3/d，H2O，xn。"), "{text}");
        assert!(!text.contains("<sup>"), "{text}");
    }

    #[test]
    fn formulas_are_typeset_and_invalid_ones_fall_back_to_their_source() {
        let document = build(&request(
            "",
            &[("a", vec![1], "公式", "勾股定理 $a^2+b^2=c^2$ 成立。\n\n$$\n\\frac{1}{2}\\sum_{i=1}^{n} x_i\n$$\n\n错误：$\\notacommand{x}$。")],
        ));
        let dir = project();
        let (paged, report) = layout(&document, dir.path(), system_fonts(), &PdfLayout { toc: false, ..PdfLayout::default() }).unwrap();
        let text = page_texts(&paged).concat();
        assert!(text.contains("勾股定理") && text.contains("成立"), "{text}");
        assert!(text.contains("\\notacommand{x}"), "{text}");
        assert_eq!(report.invalid_formulas, vec!["\\notacommand{x}"]);
    }

    #[test]
    fn common_latex_constructs_typeset_without_falling_back() {
        let formulas = [
            r"\frac{a}{b} + \sqrt{x} + \sqrt[3]{y}",
            r"\sum_{i=1}^{n} i = \frac{n(n+1)}{2}",
            r"\int_0^\infty e^{-x}\,dx = 1",
            r"\lim_{x \to 0} \frac{\sin x}{x} = 1",
            r"\alpha\beta\gamma\delta\epsilon\theta\lambda\mu\pi\sigma\phi\omega\Omega",
            r"\mathbb{R} \mathbf{v} \mathrm{d} \mathcal{L} \text{当且仅当}",
            r"\left( \frac{1}{2} \right) \cdot \times \leq \geq \neq \approx \infty \partial \nabla",
            r"\begin{pmatrix} a & b \\ c & d \end{pmatrix}",
            r"\begin{aligned} f(x) &= x^2 \\ g(x) &= 2x \end{aligned}",
            r"f(x) = \begin{cases} 1 & x > 0 \\ 0 & x \le 0 \end{cases}",
            r"\hat{x} \bar{y} \vec{v} \dot{x} \tilde{z} \overline{AB}",
            r"A \xrightarrow{f} B \Rightarrow C \iff D",
            r"\{ x \mid x \in \mathbb{N} \}",
        ];
        let markdown = formulas.iter().map(|tex| format!("$${tex}$$")).collect::<Vec<_>>().join("\n\n");
        let document = build(&request("", &[("a", vec![1], "公式", &markdown)]));
        let dir = project();
        let (_, report) = layout(&document, dir.path(), system_fonts(), &PdfLayout { toc: false, ..PdfLayout::default() }).unwrap();
        assert_eq!(report.invalid_formulas, Vec::<String>::new());
    }

    /// 可视公式编辑器（MathLive）写出的写法：浮层中的常用结构（含未填写的空位）、符号，以及它的输出风格。
    #[test]
    fn visual_formula_editor_output_typesets_without_falling_back() {
        let formulas = [
            r"\frac{}{}", r"{}^{}", r"{}_{}", r"^{}", r"_{}", r"\sqrt{}", r"\left(\right)",
            r"\sum_{}^{} + \int_{}^{} + \lim_{\to}",
            r"\begin{pmatrix}&\\&\end{pmatrix} + \begin{cases}\\\end{cases}",
            r"\frac{a}{b}+x^{2}+x_{i}+\sqrt[3]{x}+\left(a+b\right)+\sum_{i=1}^{n}+\int_{0}^{1}+\lim_{x\to0}",
            r"\alpha\beta\gamma\delta\epsilon\theta\lambda\mu\pi\rho\sigma\varphi\omega\Gamma\Delta\Theta\Lambda\Sigma\Phi\Omega",
            r"\pm\times\div\cdot\le\ge\ne\approx\equiv\propto\infty\partial\nabla\to\Rightarrow\Leftrightarrow",
            r"\in\notin\subset\subseteq\cup\cap\forall\exists\angle 90\degree",
            r"\mathrm{d}x+\mathrm{e}^{\mathrm{i}}+\operatorname{\mathrm{sin}}x+\sin x+\mathbb{R}",
        ];
        let markdown = formulas.iter().map(|tex| format!("$${tex}$$")).collect::<Vec<_>>().join("\n\n");
        let document = build(&request("", &[("a", vec![1], "公式", &markdown)]));
        let dir = project();
        let (_, report) = layout(&document, dir.path(), system_fonts(), &PdfLayout { toc: false, ..PdfLayout::default() }).unwrap();
        assert_eq!(report.invalid_formulas, Vec::<String>::new());
    }

    /// 化学式（docs/decisions.md 第 22 节）：浮层中的模板与常见写法都能排版；箭头的条件可以在上下两侧。
    #[test]
    fn chemical_equations_typeset_without_falling_back() {
        let formulas = [
            r"\ce{2H2 + O2 ->[点燃] 2H2O}",
            r"\ce{N2 + 3H2 <=>[催化剂][高温高压] 2NH3}",
            r"\ce{2KClO3 ->[MnO2][\Delta] 2KCl + 3O2 ^}",
            r"\ce{2H2 + O2 \xlongequal{点燃} 2H2O}",
            r"\ce{Ag+ + Cl- -> AgCl v} + \ce{A <- B <-> C <--> D}",
            r"\ce{CuSO4*5H2O} + \ce{[Cu(NH3)4]^2+} + \ce{SO4^{2-}} + \ce{Fe^{III}}",
            r"\ce{^{14}_{6}C -> ^{14}_{7}N + e-}",
            r"\ce{CH2=CH2 + Br2 -> CH2Br-CH2Br} + \ce{CH#CH}",
            r"\ce{NaCl(aq) + 1/2O2 + n H2O + H2SO4(浓)}",
            r"\Delta H = -57.3\,\mathrm{kJ/mol} \quad \ce{H+ + OH- -> H2O}",
            r"\ce{->[]} \ce{} \ce{->[][]}",
        ];
        let markdown = formulas.iter().map(|tex| format!("$${tex}$$")).collect::<Vec<_>>().join("\n\n");
        let document = build(&request("", &[("a", vec![1], "化学", &markdown)]));
        let dir = project();
        let (_, report) = layout(&document, dir.path(), system_fonts(), &PdfLayout { toc: false, ..PdfLayout::default() }).unwrap();
        assert_eq!(report.invalid_formulas, Vec::<String>::new());
    }

    /// 可伸长箭头的可选参数是下方的文字，不是方括号与文字（mitex 默认的规格不认识它）。
    #[test]
    fn extensible_arrows_take_text_below() {
        let document = build(&request("", &[("a", vec![1], "公式", "$$a \\xrightarrow[\\text{下方}]{\\text{上方}} b \\xrightleftharpoons[c]{} d$$")]));
        let dir = project();
        let (paged, report) = layout(&document, dir.path(), system_fonts(), &PdfLayout { toc: false, ..PdfLayout::default() }).unwrap();
        assert_eq!(report.invalid_formulas, Vec::<String>::new());
        let text = page_texts(&paged).concat();
        assert!(text.contains("上方") && text.contains("下方"), "{text}");
        assert!(!text.contains('[') && !text.contains(']'), "{text}");
    }

    /// 化学结构式（docs/decisions.md 第 22 节）：前端画好的图片按其尺寸居中嵌入，同一结构式只嵌入一次；
    /// 没有图片的以原文输出并列入报告。
    #[test]
    fn structures_are_embedded_images_and_missing_ones_fall_back_to_smiles() {
        let mut request = request("", &[("a", vec![1], "结构", "前\n\n```smiles\nCCO\n```\n\n```smiles\nCCO\n```\n\n```smiles\nC1CC(\n```\n\n后")]);
        request.structures = vec![crate::render::tests::test_structure("CCO")];
        let dir = project();
        let (paged, report) = layout(&build(&request), dir.path(), system_fonts(), &PdfLayout { toc: false, ..PdfLayout::default() }).unwrap();
        let placed = images(&paged);
        assert_eq!(placed.len(), 2);
        let (_, x, _, width, height) = placed[0];
        assert!((width - 30.0).abs() < 0.1 && (height - 15.0).abs() < 0.1, "{placed:?}");
        let text_width = paged.pages()[0].frame.width().to_pt() - 2.0 * MARGIN_PT;
        assert!((x - MARGIN_PT - (text_width - width) / 2.0).abs() < 1.0, "centered: {placed:?}");
        assert!(page_texts(&paged).concat().contains("C1CC("));
        assert_eq!(report.invalid_structures, vec!["C1CC("]);
    }

    /// 反应式的图片按 SMILES 与条件对应：条件不同的同一 SMILES 没有图片时按原文输出。
    #[test]
    fn reaction_images_match_their_conditions() {
        use crate::render::markdown::StructureConditions;
        let mut request = request("", &[("a", vec![1], "反应", "```smiles arrow=\"<=>\" above=\"催化剂\"\nN#N.[H][H]>>N\n```\n\n```smiles\nN#N.[H][H]>>N\n```")]);
        let mut image = crate::render::tests::test_structure("N#N.[H][H]>>N");
        image.conditions = StructureConditions { arrow: "<=>".into(), above: "催化剂".into(), below: String::new() };
        request.structures = vec![image];
        let dir = project();
        let (paged, report) = layout(&build(&request), dir.path(), system_fonts(), &PdfLayout { toc: false, ..PdfLayout::default() }).unwrap();
        assert_eq!(images(&paged).len(), 1);
        assert_eq!(report.invalid_structures, vec!["N#N.[H][H]>>N"]);
    }

    /// 前端传入的图片带有反应式的条件（与 RenderStructure 的 JSON 形状一致）。
    #[test]
    fn structure_conditions_deserialize_from_frontend_json() {
        let json = r#"{"smiles":"C>>C","arrow":"=","above":"光","below":"","png":"","width":1,"height":2}"#;
        let structure: crate::render::RenderStructure = serde_json::from_str(json).unwrap();
        assert_eq!(structure.conditions.arrow, "=");
        assert_eq!(structure.conditions.above, "光");
    }

    fn three_chapters(title: &str) -> Document {
        build(&request(
            title,
            &[
                ("a", vec![1], "绪论", &"绪论正文。".repeat(20)),
                ("b", vec![1, 1], "背景", "背景正文。"),
                ("c", vec![2], "方法", "方法正文。"),
            ],
        ))
    }

    #[test]
    fn paper_margin_and_double_sided_binding() {
        use crate::export::pdf_layout::{Margin, Paper};
        let paged = layout_with(
            &three_chapters("标题"),
            PdfLayout { paper: Paper::B5, margin: Margin::Narrow, ..PdfLayout::default() },
        );
        let frame = &paged.pages()[0].frame;
        assert!((frame.width().to_pt() - 176.0 / 25.4 * 72.0).abs() < 0.1);
        assert!((frame.height().to_pt() - 250.0 / 25.4 * 72.0).abs() < 0.1);

        let double = layout_with(
            &three_chapters("标题"),
            PdfLayout { binding: Binding::Double, ..PdfLayout::default() },
        );
        let texts = page_texts(&double);
        // 封面（第 1 页）之后空一页，目录从右页开始；正文与每一章都从右页（奇数页）开始。
        assert_eq!(texts[1], "");
        assert!(texts[2].contains("目录"));
        for chapter in ["1 绪论", "2 方法"] {
            let page = texts.iter().position(|t| t.starts_with(chapter)).unwrap();
            assert_eq!(page % 2, 0, "{chapter} on physical page {}", page + 1);
        }
        // 右页内侧（左边）30mm，左页内侧在右边。
        let left_edge = |page: usize| {
            placed(&double)
                .into_iter()
                .filter_map(|p| match p {
                    Placed::Text { page: p, x, .. } if p == page => Some(x),
                    _ => None,
                })
                .fold(f64::INFINITY, f64::min)
        };
        let body = texts.iter().position(|t| t.starts_with("1 绪论")).unwrap();
        assert!((left_edge(body) - 30.0 / 25.4 * 72.0).abs() < 0.5, "{}", left_edge(body));

        // 为凑右页插入的空白页上没有页眉与页码；有内容的页仍有页码。
        for cover in [true, false] {
            let paged = layout_with(
                &three_chapters("标题"),
                PdfLayout { binding: Binding::Double, cover, ..PdfLayout::default() },
            );
            let texts = page_texts(&paged);
            let blanks = texts.iter().filter(|t| !t.contains("正文") && !t.contains("目录") && *t != "标题").count();
            assert!(blanks >= 1, "{texts:?}");
            for (page, text) in texts.iter().enumerate() {
                let content = text.contains("正文") || text.contains("目录") || text == "标题";
                assert!(content || text.is_empty(), "page {}: {text:?}", page + 1);
            }
            assert!(texts.iter().any(|t| t.contains("绪论正文") && t.ends_with('1')), "{texts:?}");
            assert!(texts.iter().any(|t| t.contains("目录") && t.ends_with('i')), "{texts:?}");
        }

        // 跨多页的章节：每一页都有页码，后续页有页眉。
        let long = build(&request("标题", &[("a", vec![1], "绪论", &"很长的正文用于跨页。".repeat(500))]));
        let paged = layout_with(&long, PdfLayout { binding: Binding::Double, ..PdfLayout::default() });
        let texts = page_texts(&paged);
        let first = texts.iter().position(|t| t.starts_with("1 绪论")).unwrap();
        assert!(texts.len() - first >= 3, "{}", texts.len());
        for (number, text) in texts[first..].iter().enumerate() {
            assert!(text.ends_with(&(number + 1).to_string()), "page {}: {text:?}", first + number + 1);
        }
        assert!(texts[first + 1].starts_with("标题"), "{}", texts[first + 1]);
        assert!(texts[first + 2].starts_with("1 绪论"), "{}", texts[first + 2]);
    }

    #[test]
    fn quotes_use_kai_and_fall_back_to_serif() {
        use crate::export::pdf_layout::FontChoice;
        let book = system_fonts().book();
        // 本机有楷体时中文用楷体；没有时退回宋体类，不缺字。
        let kai: Vec<&str> = ["kaiti sc", "stkaiti", "kaiti", "ar pl ukai cn"]
            .into_iter()
            .filter(|name| book.contains_family(name))
            .collect();
        let document = build(&request("", &[("a", vec![1], "章", "正文\n\n> 引用文字")]));
        for body_font in [FontChoice::Serif, FontChoice::Sans] {
            let layout = PdfLayout {
                body_font,
                ..PdfLayout::default()
            };
            let families: Vec<String> = placed(&layout_with(&document, layout))
                .into_iter()
                .filter_map(|p| match p {
                    Placed::Text { family, text, .. } if text.contains("引用") => Some(family),
                    _ => None,
                })
                .collect();
            assert!(!families.is_empty());
            for family in &families {
                assert!(in_family(family, FontFamily::Kai), "quote font {family}");
                if !kai.is_empty() {
                    assert!(kai.contains(&family.as_str()), "quote font {family}, available Kai {kai:?}");
                }
            }
        }
    }

    #[test]
    fn body_font_size_line_height_and_paragraph_spacing() {
        use crate::export::pdf_layout::{BodySize, FontChoice, LineHeight};
        let layout: PdfLayout = serde_json::from_value(serde_json::json!({
            "paper": "a4", "margin": "normal", "binding": "single",
            "bodyFont": "sans", "headingFont": "serif", "bodySize": 14,
            "lineHeight": "loose", "paragraph": "spacing", "cover": true, "toc": false,
            "tocDepth": 2, "chapterNewPage": true, "chapterNumber": "plain",
            "header": "titleAndChapter", "pageNumber": "plain", "table": "threeLine"
        }))
        .unwrap();
        assert_eq!(layout.body_font, FontChoice::Sans);
        assert_eq!(layout.body_size, BodySize::try_from(14.0).unwrap());
        assert_eq!(layout.line_height, LineHeight::Loose);
        let document = build(&request("", &[("a", vec![1], "标题甲", &"正文段落用于测量行距。".repeat(40))]));
        let items = placed(&layout_with(&document, layout));
        let mut lines: Vec<(f64, f64)> = items
            .iter()
            .filter_map(|p| match p {
                Placed::Text { x, y, size, family, text, .. } if text.contains("正文") => {
                    assert_eq!(*size, 14.0);
                    assert!(in_family(family, FontFamily::Sans), "body font {family}");
                    Some((*y, *x))
                }
                Placed::Text { size, family, text, .. } if text.contains("标题甲") => {
                    assert_eq!(*size, 21.0);
                    assert!(in_family(family, FontFamily::Serif), "heading font {family}");
                    None
                }
                _ => None,
            })
            .collect();
        lines.sort_by(|a, b| a.partial_cmp(b).unwrap());
        lines.dedup_by(|a, b| (a.0 - b.0).abs() < 0.01);
        assert!(lines.len() >= 3);
        for pair in lines.windows(2) {
            assert!((pair[1].0 - pair[0].0 - 28.0).abs() < 0.05, "line pitch {}", pair[1].0 - pair[0].0);
        }
        // 段间空行样式：首行不缩进。
        assert!((lines[0].1 - MARGIN_PT).abs() < 0.5, "{}", lines[0].1);
    }

    #[test]
    fn without_cover_the_title_block_leads_the_first_page() {
        let document = {
            let mut request = request("论文标题", &[("a", vec![1], "绪论", "正文。"), ("b", vec![2], "方法", "正文。")]);
            request.author = "张三".into();
            build(&request)
        };
        // 有目录：文档信息在目录页顶部。
        let texts = page_texts(&layout_with(&document, PdfLayout { cover: false, ..PdfLayout::default() }));
        assert!(texts[0].starts_with("论文标题张三目录"), "{}", texts[0]);
        assert!(texts[1].starts_with("1 绪论"));
        // 没有目录：第一章紧接文档信息，之后的章节仍另起一页。
        let texts = page_texts(&layout_with(&document, PdfLayout { cover: false, toc: false, ..PdfLayout::default() }));
        assert!(texts[0].starts_with("论文标题张三1 绪论"), "{}", texts[0]);
        assert!(texts[1].starts_with("2 方法"), "{texts:?}");
    }

    #[test]
    fn toc_depth_toc_off_and_chapters_without_new_pages() {
        let document = three_chapters("标题");
        let texts = page_texts(&layout_with(&document, PdfLayout { toc_depth: 1.try_into().unwrap(), ..PdfLayout::default() }));
        assert!(texts[1].contains("1 绪论") && !texts[1].contains("背景"), "{}", texts[1]);

        let texts = page_texts(&layout_with(
            &document,
            PdfLayout { toc: false, chapter_new_page: false, ..PdfLayout::default() },
        ));
        assert!(!texts.iter().any(|t| t.contains("目录")));
        assert_eq!(texts.len(), 2, "{texts:?}");
        assert!(texts[1].contains("1 绪论") && texts[1].contains("2 方法"));
    }

    #[test]
    fn chapter_number_styles() {
        let document = three_chapters("标题");
        let texts = page_texts(&layout_with(
            &document,
            PdfLayout { chapter_number: ChapterNumber::Chapter, ..PdfLayout::default() },
        ));
        assert!(texts[1].contains("第 1 章 绪论") && texts[1].contains("1.1 背景"), "{}", texts[1]);
        assert!(texts[2].starts_with("第 1 章 绪论"));

        let texts = page_texts(&layout_with(
            &document,
            PdfLayout { chapter_number: ChapterNumber::None, ..PdfLayout::default() },
        ));
        assert!(texts[2].starts_with("绪论") && texts[2].contains("背景"), "{}", texts[2]);
        assert!(!texts[1].contains("1 绪论"));
    }

    #[test]
    fn header_and_page_number_styles() {
        let long = build(&request("文档", &[("a", vec![1], "绪论", &"很长的正文用于跨页。".repeat(400))]));
        let texts = page_texts(&layout_with(
            &long,
            PdfLayout { page_number: PageNumber::Page, header: Header::Title, ..PdfLayout::default() },
        ));
        assert!(texts[2].ends_with("第 1 页"), "{}", texts[2]);
        // 页眉只有文档标题，不含章节名。
        assert!(texts[3].starts_with("文档页。") && texts[3].ends_with("第 2 页"), "{}", texts[3]);

        let texts = page_texts(&layout_with(
            &long,
            PdfLayout { page_number: PageNumber::Total, header: Header::None, ..PdfLayout::default() },
        ));
        let total = texts.len() - 2;
        // 没有页眉：页面直接从正文开始。
        assert!(texts[3].starts_with("页。") && texts[3].ends_with(&format!("2 / {total}")), "{}", texts[3]);
    }

    #[test]
    fn grid_tables_use_a_uniform_stroke() {
        let dir = project();
        let mut writer = Writer::new(dir.path(), &PdfLayout { table: TableStyle::Grid, ..PdfLayout::default() });
        let document = build(&request("", &[("a", vec![1], "表", "| 甲 | 乙 |\n| - | - |\n| 1 | 2 |")]));
        writer.preamble(&document, system_fonts().book());
        writer.section(&document.sections[0]);
        assert!(writer.out.contains("#set table(stroke: 0.5pt + luma(160)"));
        assert!(!writer.out.contains("stroke: writer-three-line"));
        assert!(layout_with(&document, PdfLayout { table: TableStyle::Grid, ..PdfLayout::default() }).pages().len() == 2);
    }

    #[test]
    fn untitled_documents_have_no_cover() {
        let dir = project();
        let document = build(&request("", &[("a", vec![1], "章", "正文。")]));
        let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        let texts = page_texts(&paged);
        assert_eq!(paged.pages().len(), 2);
        assert!(texts[0].contains("目录"));
        assert!(texts[1].starts_with("1 章"));
    }

    #[test]
    fn body_paragraphs_indent_their_first_line_but_lists_and_quotes_do_not() {
        let dir = project();
        let paragraph = "首行缩进的段落。".repeat(12);
        let markdown = format!("{paragraph}\n\n- 列表项\n\n> 引用段落");
        let document = build(&request("", &[("a", vec![1], "章", &markdown)]));
        let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        let lines: Vec<(f64, f64, String)> = placed(&paged)
            .into_iter()
            .filter_map(|p| match p {
                Placed::Text { page: 1, x, y, text, .. } => Some((x, y, text)),
                _ => None,
            })
            .collect();
        let starts = |needle: &str| -> Vec<f64> {
            let mut rows: Vec<(f64, f64)> = lines
                .iter()
                .filter(|(_, _, t)| t.contains(needle))
                .map(|(x, y, _)| (*y, *x))
                .collect();
            rows.sort_by(|a, b| a.partial_cmp(b).unwrap());
            rows.dedup_by(|a, b| (a.0 - b.0).abs() < 0.01);
            rows.into_iter().map(|(_, x)| x).collect()
        };
        let paragraph = starts("段落。");
        assert!(paragraph.len() >= 2, "paragraph should wrap");
        // 首行缩进 2 字符（24 磅），后续行顶格。
        assert!((paragraph[0] - MARGIN_PT - 24.0).abs() < 0.5, "{paragraph:?}");
        assert!((paragraph[1] - MARGIN_PT).abs() < 0.5, "{paragraph:?}");
        // 列表与引用内的段落不缩进：列表文字紧跟项目符号，引用文字紧跟左侧竖线与内边距。
        assert!(starts("列表项")[0] < MARGIN_PT + 24.0, "{:?}", starts("列表项"));
        assert!(starts("引用段落")[0] < MARGIN_PT + 24.0, "{:?}", starts("引用段落"));
    }

    #[test]
    fn figures_are_centered_and_never_enlarged() {
        let dir = project();
        write_image(&dir.path().join("assets/小.png"), 200, 100, ImageFormat::Png);
        write_image(&dir.path().join("assets/宽.png"), 2000, 500, ImageFormat::Png);
        let document = build(&request(
            "",
            &[(
                "a",
                vec![1],
                "图",
                "![](../assets/小.png)\n\n![宽图](../assets/宽.png)",
            )],
        ));
        let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        let page_width = paged.pages()[0].frame.width().to_pt();
        let images = images(&paged);
        assert_eq!(images.len(), 2);
        // 小图：原始尺寸（200px = 150pt），居中。
        assert!((images[0].3 - 150.0).abs() < 0.1);
        assert!((images[0].1 + images[0].3 / 2.0 - page_width / 2.0).abs() < 0.5);
        // 宽图：缩小到正文宽度，比例不变。
        assert!((images[1].3 - TEXT_WIDTH_PT).abs() < 0.5, "{images:?}");
        assert!((images[1].3 / images[1].4 - 4.0).abs() < 0.01);
    }

    #[test]
    fn tall_figure_uses_the_full_text_area_and_moves_with_its_caption() {
        let dir = project();
        write_image(&dir.path().join("assets/竖图.png"), 400, 1600, ImageFormat::Png);
        let document = build(&request(
            "",
            &[(
                "a",
                vec![1],
                "图片",
                &format!("{}\n\n![竖图的图注](../assets/竖图.png)", "正文。".repeat(30)),
            )],
        ));
        let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        let page_height = paged.pages()[0].frame.height().to_pt();
        let images = images(&paged);
        assert_eq!(images.len(), 1);
        let (page, _, y, width, height) = images[0];
        // 第 0 页是目录。标题与正文之后放不下：整体移到下一页，而不是缩小后塞进章节首页的剩余空间。
        assert_eq!(page, 2);
        // 高度按完整正文区扣除实际测得的一行图注（10 磅字号、1em 行框）与间距计算，比例不变。
        let expected = TEXT_HEIGHT_PT - IMAGE_HEIGHT_SLACK - FIGURE_GAP_EM * 12.0 - 10.0;
        assert!((height - expected).abs() < 0.5, "{height} vs {expected}");
        assert!((width / height - 0.25).abs() < 1e-3);
        // 图片与图注在同一页，且都在正文区内，不占用页脚。
        assert!(y >= MARGIN_PT - 0.5 && y + height <= page_height - MARGIN_PT + 0.5);
        let caption = placed(&paged).into_iter().find_map(|p| match p {
            Placed::Text { page, y, text, .. } if text.contains("图注") => Some((page, y)),
            _ => None,
        });
        let (caption_page, caption_y) = caption.expect("caption");
        assert_eq!(caption_page, 2);
        assert!(caption_y <= page_height - MARGIN_PT + 0.5, "{caption_y}");
    }

    #[test]
    fn figures_in_quotes_fit_the_quote_width() {
        let dir = project();
        write_image(&dir.path().join("assets/宽.png"), 2000, 500, ImageFormat::Png);
        let document = build(&request(
            "",
            &[("a", vec![1], "引", "> ![宽](../assets/宽.png)")],
        ));
        let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        let (_, x, _, width, height) = images(&paged)[0];
        // 引用有左侧缩进：图片缩小到引用内的可用宽度，不越出正文区右边界。
        assert!(x > MARGIN_PT + 5.0, "{x}");
        assert!(x + width <= MARGIN_PT + TEXT_WIDTH_PT + 0.5, "{x} + {width}");
        assert!((width / height - 4.0).abs() < 0.01);
    }

    /// 页脚中的页码：正文为阿拉伯数字，目录为小写罗马数字。
    fn is_page_label(paged: &PagedDocument, page: usize, text: &str) -> bool {
        let text = text.trim();
        text == paged.pages()[page].number.to_string()
            || (!text.is_empty() && text.chars().all(|c| "ivxlc".contains(c)))
    }

    /// 所有页面上的图片与文字基线都在正文区内：不越过上边距，底边不进入页脚页码区域。
    fn assert_inside_text_area(paged: &PagedDocument) {
        let page_height = paged.pages()[0].frame.height().to_pt();
        let top = MARGIN_PT - 0.5;
        let bottom = page_height - MARGIN_PT + 0.5;
        for item in placed(paged) {
            match item {
                Placed::Image { page, y, height, .. } => {
                    assert!(y >= top, "page {page}: image top {y} < {top}");
                    assert!(y + height <= bottom, "page {page}: image bottom {} > {bottom}", y + height)
                }
                Placed::Text { page, y, text, .. } if !is_page_label(paged, page, &text) => {
                    assert!(y <= bottom, "page {page}: text {text:?} baseline {y} > {bottom}")
                }
                _ => {}
            }
        }
    }

    #[test]
    fn tall_image_in_a_table_cell_stays_inside_the_text_area() {
        let dir = project();
        write_image(&dir.path().join("assets/长.png"), 200, 4000, ImageFormat::Png);
        let document = build(&request(
            "",
            &[(
                "a",
                vec![1],
                "表",
                "| 图 | 说明 |\n| --- | --- |\n| ![长](../assets/长.png) | 很长的图 |",
            )],
        ));
        let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        assert_eq!(images(&paged).len(), 1);
        assert_inside_text_area(&paged);
    }

    #[test]
    fn tall_image_mixed_with_text_in_a_table_cell_stays_inside_the_text_area() {
        let dir = project();
        write_image(&dir.path().join("assets/长.png"), 200, 4000, ImageFormat::Png);
        let text = "W".repeat(60);
        // 图片所在行比图片多出基线下方的部分；图片前后的文字各自成行，可以随表格行跨页。
        for cell in [
            format!("![长](../assets/长.png) {text}"),
            format!("{text} ![长](../assets/长.png)"),
            format!("{text} ![长](../assets/长.png) {text}"),
        ] {
            let markdown = format!("| 图 | 说明 |\n| --- | --- |\n| {cell} | 很长的图 |");
            let document = build(&request("", &[("a", vec![1], "表", &markdown)]));
            let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
            assert_eq!(images(&paged).len(), 1, "{cell}");
            assert_inside_text_area(&paged);
        }
    }

    #[test]
    fn images_in_the_repeating_table_header_are_limited_to_a_quarter_page() {
        let dir = project();
        write_image(&dir.path().join("assets/长.png"), 200, 4000, ImageFormat::Png);
        let document = build(&request(
            "",
            &[("a", vec![1], "表", "| ![长](../assets/长.png) | 说明 |\n| --- | --- |\n| 1 | 2 |")],
        ));
        let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        let (_, _, _, _, height) = images(&paged)[0];
        assert!((height - TEXT_HEIGHT_PT / 4.0).abs() < 0.5, "{height}");
        assert_inside_text_area(&paged);
    }

    #[test]
    fn header_wrapping_is_measured_with_the_final_column_widths() {
        let dir = project();
        write_image(&dir.path().join("assets/长.png"), 200, 4000, ImageFormat::Png);
        let markdown = format!(
            "| {} | 说明 |\n| --- | --- |\n| ![长](../assets/长.png) | {} |",
            "很长的表头文字".repeat(3).chars().take(20).collect::<String>(),
            "W".repeat(40)
        );
        for markdown in [markdown.clone(), format!("> {}", markdown.replace('\n', "\n> "))] {
            let document = build(&request("", &[("a", vec![1], "表", &markdown)]));
            let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
            assert_eq!(images(&paged).len(), 1);
            assert_inside_text_area(&paged);
        }
    }

    #[test]
    fn long_tables_with_images_still_break_across_pages() {
        let dir = project();
        write_image(&dir.path().join("assets/图.png"), 400, 300, ImageFormat::Png);
        let mut markdown = String::from("| 序号 | 图 |\n| --- | --- |\n");
        for i in 1..=12 {
            markdown.push_str(&format!("| {i} | ![图](../assets/图.png) |\n"));
        }
        let document = build(&request("", &[("a", vec![1], "表", &markdown)]));
        let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        assert!(paged.pages().len() > 1);
        assert_eq!(images(&paged).len(), 12);
        assert_inside_text_area(&paged);
        // 表头在正文的每页重复（第 0 页是目录）。
        let heads = placed(&paged)
            .into_iter()
            .filter(|p| matches!(p, Placed::Text { text, .. } if text.contains("序号")))
            .count();
        assert_eq!(heads, paged.pages().len() - 1);
    }

    #[test]
    fn table_note_stays_on_the_page_of_the_last_row() {
        let dir = project();
        // 行数跨过分页处：无论表格在哪里结束，表注都与最后一行在同一页，只出现一次。
        for count in 20..=45 {
            let mut markdown = String::from("| 序号 | 内容 |\n| --- | --- |\n");
            for i in 1..=count {
                markdown.push_str(&format!("| R{i} | 内容 |\n"));
            }
            markdown.push_str("\nTable-note: 注：表注文字。");
            let document = build(&request("", &[("a", vec![1], "表", &markdown)]));
            let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
            let page_of = |needle: &str| -> Vec<usize> {
                placed(&paged)
                    .into_iter()
                    .filter_map(|p| match p {
                        Placed::Text { page, text, .. } if text.contains(needle) => Some(page),
                        _ => None,
                    })
                    .collect()
            };
            let last = page_of(&format!("R{count}"));
            let note = page_of("表注文字");
            assert_eq!(note.len(), 1, "{count}");
            assert_eq!(note, last, "{count} rows");
            assert_inside_text_area(&paged);
        }
    }

    #[test]
    fn table_note_does_not_widen_the_columns() {
        let dir = project();
        let x_of = |markdown: &str| {
            let document = build(&request("", &[("a", vec![1], "表", markdown)]));
            let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
            placed(&paged)
                .into_iter()
                .find_map(|p| match p {
                    Placed::Text { x, text, .. } if text.contains("乙") => Some(x),
                    _ => None,
                })
                .unwrap()
        };
        // 第二列右对齐：列变宽时“乙”会右移。
        let table = "| 甲 | 乙 |\n| - | -: |\n| 1 | 2 |";
        let plain = x_of(table);
        let noted = x_of(&format!("{table}\n\nTable-note: {}", "很长的表注文字".repeat(20)));
        assert!((plain - noted).abs() < 0.5, "{plain} vs {noted}");
    }

    #[test]
    fn extremely_narrow_images_keep_the_height_limit() {
        let dir = project();
        write_image(&dir.path().join("assets/细.png"), 10, 10000, ImageFormat::Png);
        let document = build(&request(
            "",
            &[("a", vec![1], "细", "![细](../assets/细.png)\n\n文字 ![细](../assets/细.png) 文字")],
        ));
        let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        assert_eq!(images(&paged).len(), 2);
        for (_, _, y, _, height) in images(&paged) {
            assert!(y >= MARGIN_PT - 0.5, "{y}");
            assert!(height <= TEXT_HEIGHT_PT, "{height}");
        }
        assert_inside_text_area(&paged);
    }

    #[test]
    fn tall_image_in_a_paragraph_stays_inside_the_text_area() {
        let dir = project();
        write_image(&dir.path().join("assets/长.png"), 200, 4000, ImageFormat::Png);
        let document = build(&request(
            "",
            &[("a", vec![1], "段", "文字 ![长](../assets/长.png) 文字")],
        ));
        let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        assert_inside_text_area(&paged);
    }

    #[test]
    fn long_wrapped_caption_under_a_tall_figure_stays_above_the_footer() {
        let dir = project();
        write_image(&dir.path().join("assets/竖图.png"), 400, 1600, ImageFormat::Png);
        let caption = vec!["W".repeat(30); 4].join(" ");
        let document = build(&request(
            "",
            &[("a", vec![1], "图", &format!("![{caption}](../assets/竖图.png)"))],
        ));
        let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        assert_inside_text_area(&paged);
        // 图片与整段图注在同一页。
        let image_page = images(&paged)[0].0;
        for item in placed(&paged) {
            if let Placed::Text { page, text, .. } = item {
                if text.contains('W') {
                    assert_eq!(page, image_page, "caption line on another page");
                }
            }
        }
    }

    #[test]
    fn inline_images_fit_their_container() {
        let dir = project();
        write_image(&dir.path().join("assets/宽.png"), 1200, 600, ImageFormat::Png);
        write_image(&dir.path().join("assets/长.png"), 200, 4000, ImageFormat::Png);
        let document = build(&request(
            "",
            &[(
                "a",
                vec![1],
                "表",
                "| 甲 | 乙 | 丙 |\n| --- | --- | --- |\n| ![宽](../assets/宽.png) | 2 | 3 |\n\n\
                 文字 ![长](../assets/长.png) 文字",
            )],
        ));
        let (paged, _) = layout(&document, dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        let images = images(&paged);
        assert_eq!(images.len(), 2, "{images:?}");
        // 表格单元格：按列数等分正文宽度、去掉内边距（453.5 / 3 − 12 磅），保持比例，不按文字行高压成小图。
        let (_, x, _, width, height) = images[0];
        assert!((width - (TEXT_WIDTH_PT / 3.0 - 12.0)).abs() < 0.1, "{width}");
        assert!((width / height - 2.0).abs() < 0.01);
        assert!(x + width <= MARGIN_PT + TEXT_WIDTH_PT / 3.0 + 0.5);
        // 正文中的超长图：高度不超过正文区。
        let (_, _, _, width, height) = images[1];
        assert!(height <= TEXT_HEIGHT_PT - IMAGE_HEIGHT_SLACK + 0.5, "{height}");
        assert!((height / width - 20.0).abs() < 0.05);
    }

    #[test]
    fn user_text_cannot_inject_typst_markup() {
        let dir = project();
        let hostile = [
            "\"]#panic(\"x\")[",
            "#panic(\"boom\")",
            "\\\" \\\\ \\n $ x^2 $ @ref <label> * _ ` ~ = - + / [ ] { }",
            "#import \"/etc/passwd\"",
            "控制字符\u{0}\u{1b}\u{7f}",
        ];
        for text in hostile {
            let document = build(&request(
                text,
                &[("a", vec![1], text, &format!("{text}\n\n- {text}\n\n| {text} |\n| - |\n| {text} |\n\n`{text}`\n\n```{text}\n{text}\n```"))],
            ));
            let result = export(&document, dir.path(), system_fonts(), &PdfLayout::default());
            assert!(result.is_ok(), "{text:?}: {result:?}");
        }
    }

    #[test]
    fn empty_deep_and_long_documents() {
        let dir = project();
        let (pdf, _) = export(&build(&request("", &[])), dir.path(), system_fonts(), &PdfLayout::default()).unwrap();
        assert!(pdf.starts_with(b"%PDF-"));

        let deep = build(&request(
            "深",
            &[("d", vec![1; 32], "第 32 层", "# 正文标题")],
        ));
        assert!(export(&deep, dir.path(), system_fonts(), &PdfLayout::default()).is_ok());

        let owned: Vec<(String, Vec<u32>, String, String)> = (1..=200)
            .map(|i| {
                (
                    format!("c{i}"),
                    vec![i],
                    format!("第 {i} 章"),
                    "长文档正文。".repeat(40),
                )
            })
            .collect();
        let chapters: Vec<(&str, Vec<u32>, &str, &str)> = owned
            .iter()
            .map(|(a, b, c, d)| (a.as_str(), b.clone(), c.as_str(), d.as_str()))
            .collect();
        let (pdf, _) = export(
            &build(&request("长文档", &chapters)),
            dir.path(),
            system_fonts(),
            &PdfLayout::default(),
        )
        .unwrap();
        assert!(
            page_count(&pdf) > 10 || pdf.len() > 100_000,
            "a long document spans many pages"
        );
    }

    #[test]
    fn missing_cjk_font_is_reported_only_for_chinese_documents() {
        static EMBEDDED_ONLY: OnceLock<FontStore> = OnceLock::new();
        let fonts = EMBEDDED_ONLY.get_or_init(|| {
            let mut store = FontStore::new();
            store.extend(typst_kit::fonts::embedded());
            store
        });
        let dir = project();
        let chinese = build(&request("论文", &[("a", vec![1], "绪论", "正文")]));
        assert_eq!(
            export(&chinese, dir.path(), fonts, &PdfLayout::default()),
            Err(ExportError::NoCjkFont)
        );
        let english = build(&request("Paper", &[("a", vec![1], "Intro", "Body text.")]));
        assert!(export(&english, dir.path(), fonts, &PdfLayout::default()).is_ok());
    }

    /// 合并单元格（docs/decisions.md 第 23 节）：区域左上角是 table.cell，被合并的位置不输出；
    /// 三线表的底线是最后一行之后的横线，不会在跨行的单元格下方断开。
    #[test]
    fn merged_cells_span_rows_and_columns() {
        let dir = project();
        let mut writer = Writer::new(dir.path(), &PdfLayout::default());
        let markdown = "| 地区 | 2024 || 备注 |\n| --- | --- | --- | --- |\n| 华东 | 1 | 2 | 甲 |\n| ^^ | 3 || 乙 |";
        let document = build(&request("", &[("a", vec![1], "表", markdown)]));
        writer.preamble(&document, system_fonts().book());
        writer.section(&document.sections[0]);
        assert!(writer.out.contains("table.header([#\"地区\"], table.cell(colspan: 2, rowspan: 1)[#\"2024\"], [#\"备注\"])"), "{}", writer.out);
        assert!(writer.out.contains("table.cell(colspan: 1, rowspan: 2)[#\"华东\"], [#\"1\"], [#\"2\"], [#\"甲\"], table.cell(colspan: 2, rowspan: 1)[#\"3\"], [#\"乙\"], table.hline(stroke: 1pt)"), "{}", writer.out);
        assert_eq!(layout_with(&document, PdfLayout::default()).pages().len(), 2);
    }

    #[test]
    fn string_literal_escaping() {
        assert_eq!(string("a\"b\\c\nd\u{0}"), "\"a\\\"b\\\\c\\nd\"");
    }
}

// 让补丁的回归测试随 Writer 的 cargo test 执行，无需另维护 vendor workspace。
#[cfg(test)]
#[path = "../../vendor/krilla/src/graphics/png_predictor.rs"]
mod png_predictor_tests;

/// 手动检查用：`WRITER_SAMPLE_DIR=<目录> cargo test write_sample_pdf -- --ignored`。
/// 可选 `WRITER_SAMPLE_LAYOUT=<JSON>` 覆盖部分排版配置（字段同前端 PdfLayout）。
#[cfg(test)]
#[test]
#[ignore]
fn write_sample_pdf() {
    use crate::export::images::tests::write_image;
    use crate::render::{build, RenderChapter, RenderRequest};
    let out =
        std::path::PathBuf::from(std::env::var("WRITER_SAMPLE_DIR").expect("WRITER_SAMPLE_DIR"));
    let root = out.join("sample-project");
    std::fs::create_dir_all(root.join("assets")).unwrap();
    std::fs::create_dir_all(root.join("content")).unwrap();
    write_image(
        &root.join("assets/示意图.png"),
        640,
        320,
        image::ImageFormat::Png,
    );
    // 竖长图用于核对完整正文区高度限制与图注预留。
    write_image(
        &root.join("assets/曲线.png"),
        320,
        1600,
        image::ImageFormat::Png,
    );
    let chapter = |id: &str, number: Vec<u32>, title: &str, markdown: &str| RenderChapter {
        id: id.into(),
        number,
        title: title.into(),
        markdown: markdown.into(),
    };
    let request = RenderRequest {
        title: "Writer 示例文档".into(),
        subtitle: "长文档写作与输出示例".into(),
        author: "Writer 团队".into(),
        chapters: vec![
            chapter("a", vec![1], "绪论", "长文档写作需要**清晰的结构**与*稳定的输出*。中文段落\n折行不会产生多余空格。\n\n上下标：处理规模 5000 m<sup>3</sup>/d，H<sub>2</sub>O 与 NH<sub>4</sub><sup>+</sup>，**容积负荷 1.2 kg/(m<sup>3</sup>·d)**。\n\n- 章节组织\n- 自动编号\n  1. 子项一\n  2. 子项二\n\n注入测试：\"]#panic(\"x\")[ $ x $ #strong[不应加粗]\n\n章节引用：详见[旧](writer:chapter/c)与第[旧](writer:chapter/b?show=number)节。"),
            chapter("b", vec![1, 1], "研究背景", "> 引用：方法决定结果。\n\nTable: 样本构成\n\n| 组别 | 样本数 |\n| --- | --: |\n| 对照组 | 30 |\n| 实验组 | 32 |\n\nTable-note: 注：数据来自 2025 年问卷调查，实验组含 2 名中途退出者；样本数为最终纳入分析的人数。\n\n表格之后的正文段落。"),
            chapter("c", vec![2], "方法", "![示意图](../assets/示意图.png)\n\n![曲线（竖长图）](../assets/曲线.png)\n\n```\nfn main() {\n    println!(\"你好\");\n}\n```\n\n## 正文小标题\n\n访问 [官网](https://example.com)。\n\n1. 第一步\n2. 第二步"),
        ],
        references: Vec::new(),
        structures: Vec::new(),
    };
    let (bytes, report) = export(&build(&request), &root, font_store(None), &sample_layout()).unwrap();
    assert!(report.missing_images.is_empty());
    std::fs::write(out.join("sample.pdf"), bytes).unwrap();
}

#[cfg(test)]
fn sample_layout() -> PdfLayout {
    let Ok(overrides) = std::env::var("WRITER_SAMPLE_LAYOUT") else {
        return PdfLayout::default();
    };
    let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/pdf_layout_default.json");
    let mut layout: serde_json::Value = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    let overrides: serde_json::Value = serde_json::from_str(&overrides).expect("WRITER_SAMPLE_LAYOUT");
    for (key, value) in overrides.as_object().expect("object") {
        layout[key] = value.clone();
    }
    serde_json::from_value(layout).expect("valid layout")
}
