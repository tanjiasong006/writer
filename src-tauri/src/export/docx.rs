//! Word（.docx）导出，基于 docx-rs。
//!
//! - 章节标题使用内置标题样式（Heading 1..9），Word 导航窗格与目录可直接使用；编号是静态文本，
//!   与 PDF 一致，不依赖 Word 的自动编号。
//! - 正文内的 `#` 标题叠加在章节层级之下，不带编号。
//! - 所有写入 XML 的文本先去掉 XML 1.0 不允许的控制字符，否则 Word 会拒绝打开整个文件。
//! - 图片缺失或损坏时输出占位文字并记录在报告中，绝不 panic。
//! - 排版使用默认输出参数（`export::theme`，与 PDF 默认样式一致，docs/decisions.md 第 5 节）：字体、字号与行距
//!   写入 Normal（文档默认），正文段落、列表、标题、图注使用内置样式（Body Text、List Paragraph、Heading 1..9、
//!   Caption），接收者可以统一修改样式、使用导航窗格与生成目录。
//! - 有文档信息时第一页是封面（不显示页眉页码，正文从第 1 页开始）；一级章节另起一页。
//! - 图片按统一规则确定尺寸（`export::images`）：保持比例、不放大，不超过所在容器的宽度与正文区高度；
//!   独立成段的图片居中，为图注预留空间并与图注保持在同一页，实际分页由 Word / WPS 完成。

use std::io::{Cursor, Write};
use std::path::Path;

use docx_rs::{
    AbstractNumbering, AlignmentType, BorderType, BreakType, Docx, Footer, Footnote, Header, Hyperlink,
    HyperlinkType, IndentLevel, Level, LevelJc, LevelOverride, LevelText, LineSpacing,
    LineSpacingType, NumberFormat, Numbering, NumberingId, PageMargin, PageNum, PageNumType,
    Paragraph, ParagraphBorder, ParagraphBorderPosition, ParagraphBorders, Pic, Run, RunFonts,
    Shading, ShdType, SpecialIndentType, Start, Style, StyleType, Table, TableBorder,
    TableBorderPosition, TableBorders, TableCell, TableCellBorder, TableCellBorderPosition,
    TableCellBorders, TableRow, VertAlignType, WidthType,
};

use super::fonts::{docx_fonts, FontFamily};
use super::images::{display_size_pt, load_for_export, text_height_pt, Bounds};
use super::theme::Theme;
use super::{ExportError, ExportReport};
use crate::render::citations::Citations;
use crate::render::elements::{ElementTarget, ElementTargets};
use crate::render::chapter_reference::{broken_references, ref_text, ChapterTargets, RefShow};
use crate::render::markdown::{Align, Block, Inline};
use crate::render::{resolve_image, Document, Section};

/// A4，单位 twip（1/20 磅）。
const PAGE_WIDTH: u32 = 11906;
const PAGE_HEIGHT: u32 = 16838;
const MARGIN: i32 = 1440;
const TEXT_WIDTH: u32 = PAGE_WIDTH - 2 * MARGIN as u32;
const TEXT_HEIGHT: u32 = PAGE_HEIGHT - 2 * MARGIN as u32;
/// Word 表格单元格默认的左右内边距（twip）；docx-rs 不写 tblCellMar，Word / WPS 使用这个默认值。
const CELL_MARGIN: u32 = 108;
/// 图片高度上限再留出的余量（磅），吸收行高取整等差异，保证图片不会被挤出页面。
const IMAGE_HEIGHT_SLACK: f64 = 4.0;
/// 表格文字（TableText）段前段后各 40 twip。
const TABLE_TEXT_SPACING_PT: f64 = 4.0;
/// 表头中的图片不超过正文区高度的这个比例：表头在每页重复，不能占满页面。
const HEADER_IMAGE_SHARE: f64 = 0.25;
/// 1 磅 = 12700 EMU。
const EMU_PER_PT: f64 = 12700.0;
const LIST_INDENT: i32 = 420;
// docx-rs 默认已定义 abstractNum 1 / num 1，这里的编号定义从 10 开始，避免重复 id。
const BULLET_ABSTRACT: usize = 10;
const DECIMAL_ABSTRACT: usize = 11;
const BULLET_NUMBERING: usize = 10;
const FIRST_LIST_NUMBERING: usize = 11;
const MAX_HEADING: usize = 9;

/// 磅 → Word 的半磅字号。
fn half_points(pt: f64) -> usize {
    (pt * 2.0).round() as usize
}

/// 副标题的字号（磅）。
const SUBTITLE_PT: f64 = 16.0;
/// 封面上标题之前的留白：正文区高度的 28%，标题约在页面 1/3 高处（与 PDF 封面一致）。
const COVER_TOP: u32 = TEXT_HEIGHT * 28 / 100;
/// 一级章节另起一页后，标题上方的留白（磅，约 3em）。
const CHAPTER_TOP_PT: f64 = 36.0;
/// 页眉、页脚文字的字号（磅）。
const META_PT: f64 = 9.0;

// 颜色与 PDF 一致：正文纯黑，辅助信息只用灰阶，链接深蓝。
const INFO_COLOR: &str = "3C3C3C";
const QUOTE_COLOR: &str = "505050";
const META_COLOR: &str = "646464";
const COVER_LINE_COLOR: &str = "787878";
const RULE_COLOR: &str = "A0A0A0";
const QUOTE_BAR_COLOR: &str = "C8C8C8";
const INLINE_CODE_FILL: &str = "EEEEEE";
const CODE_FILL: &str = "F5F5F5";
const LINK_COLOR: &str = "1F4E9A";

/// 磅 → twip（1/20 磅）。
fn twips(pt: f64) -> u32 {
    (pt * 20.0).round() as u32
}

pub fn export(
    document: &Document,
    project_root: &Path,
) -> Result<(Vec<u8>, ExportReport), ExportError> {
    let mut writer = Writer {
        theme: Theme::default(),
        root: project_root,
        report: ExportReport {
            broken_references: broken_references(document),
            ..ExportReport::default()
        },
        targets: ChapterTargets::new(document),
        elements: ElementTargets::new(document),
        citations: Citations::new(document),
        next_numbering: FIRST_LIST_NUMBERING,
        numberings: Vec::new(),
        items: Vec::new(),
    };

    // 封面：标题、细线、副标题、作者，各用自己的段落样式；空的不输出。
    // 第一个一级章节另起一页，封面因此独占第一页。
    let cover = [&document.title, &document.subtitle, &document.author]
        .iter()
        .any(|text| !text.trim().is_empty());
    for (style, text) in [
        ("Title", &document.title),
        ("Subtitle", &document.subtitle),
        ("Author", &document.author),
    ] {
        if !text.trim().is_empty() {
            writer.items.push(Item::Paragraph(
                Paragraph::new()
                    .style(style)
                    .add_run(Run::new().add_text(xml_safe(text.trim()))),
            ));
        }
        if style == "Title" && cover {
            writer
                .items
                .push(Item::Paragraph(short_rule(0.4, 5, COVER_LINE_COLOR)));
        }
    }
    for section in &document.sections {
        writer.section(section);
    }
    writer.bibliography();

    let mut docx = base_document(&writer.theme, document.title.trim(), cover);
    for numbering in writer.numberings.drain(..) {
        docx = docx.add_numbering(numbering);
    }
    for item in writer.items.drain(..) {
        docx = match item {
            Item::Paragraph(p) => docx.add_paragraph(p),
            Item::Table(t) => docx.add_table(t),
        };
    }

    let mut xml = docx.build();
    xml.document = mark_header_rows(&xml.document);
    xml.footnotes = footnote_marks(&xml.footnotes);
    xml.doc_props.core = core_properties(&document.title, &document.author);
    let bytes = pack_with_jpeg(xml).map_err(|error| ExportError::RenderFailed {
        message: error.to_string(),
    })?;
    Ok((bytes, writer.report))
}

/// 脚注内容开头的编号标记在生成时先写成这个占位文字（docx-rs 没有 footnoteRef 元素）。
const FOOTNOTE_MARK_TEXT: &str = "\u{E000}";

/// 把脚注内容中的占位文字换成 Word 的脚注编号标记 `<w:footnoteRef/>`（显示为该脚注的编号）。
fn footnote_marks(xml: &[u8]) -> Vec<u8> {
    let text = String::from_utf8_lossy(xml);
    let mut out = String::with_capacity(text.len());
    let mut rest: &str = &text;
    while let Some(end) = rest.find(&format!("{FOOTNOTE_MARK_TEXT}</w:t>")) {
        let Some(start) = rest[..end].rfind("<w:t") else {
            break;
        };
        out.push_str(&rest[..start]);
        out.push_str("<w:footnoteRef />");
        rest = &rest[end + FOOTNOTE_MARK_TEXT.len() + "</w:t>".len()..];
    }
    out.push_str(rest);
    out.into_bytes()
}

/// 文档属性（docProps/core.xml）：标题与作者。docx-rs 没有设置它们的接口，默认写出的
/// 作者是 "unknown"，因此整体生成；空的项不写出。
fn core_properties(title: &str, author: &str) -> Vec<u8> {
    let mut xml = String::from(
        "<?xml version=\"1.0\" encoding=\"UTF-8\" standalone=\"yes\"?>\
         <cp:coreProperties xmlns:cp=\"http://schemas.openxmlformats.org/package/2006/metadata/core-properties\" \
         xmlns:dc=\"http://purl.org/dc/elements/1.1/\" xmlns:dcterms=\"http://purl.org/dc/terms/\" \
         xmlns:dcmitype=\"http://purl.org/dc/dcmitype/\" xmlns:xsi=\"http://www.w3.org/2001/XMLSchema-instance\">",
    );
    for (tag, value) in [("dc:title", title), ("dc:creator", author)] {
        let value = xml_safe(value.trim());
        if !value.is_empty() {
            xml.push_str(&format!("<{tag}>{}</{tag}>", escape_xml(&value)));
        }
    }
    xml.push_str("</cp:coreProperties>");
    xml.into_bytes()
}

fn escape_xml(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
}

/// docx-rs 只按 .png 打包 Pic。将 JPEG 从默认媒体中移出，修正关系后以 .jpeg 追加。
/// 库已声明 jpeg → image/jpeg 的内容类型；PNG 与其余文档部件仍由库原样打包。
fn pack_with_jpeg(mut xml: docx_rs::XMLDocx) -> zip::result::ZipResult<Vec<u8>> {
    let mut jpegs = Vec::new();
    for (id, bytes) in std::mem::take(&mut xml.media) {
        if bytes.starts_with(&[0xff, 0xd8]) {
            jpegs.push((id, bytes));
        } else {
            xml.media.push((id, bytes));
        }
    }
    if !jpegs.is_empty() {
        // 只替换生成器产生的精确 Target 属性，不修改正文中的文字或外部链接。
        for part in std::iter::once(&mut xml.document_rels)
            .chain(xml.header_rels.iter_mut())
            .chain(xml.footer_rels.iter_mut())
        {
            let mut rels = String::from_utf8(std::mem::take(part)).map_err(|_| {
                zip::result::ZipError::InvalidArchive("invalid relationship XML".into())
            })?;
            for (id, _) in &jpegs {
                rels = rels.replace(
                    &format!("Target=\"media/{id}.png\""),
                    &format!("Target=\"media/{id}.jpeg\""),
                );
            }
            *part = rels.into_bytes();
        }
    }
    let mut bytes = Cursor::new(Vec::new());
    xml.pack(&mut bytes)?;
    if !jpegs.is_empty() {
        let mut archive = zip::ZipWriter::new_append(&mut bytes)?;
        // JPEG 已压缩，直接存放，避免无收益的二次压缩。
        let options = zip::write::SimpleFileOptions::default()
            .compression_method(zip::CompressionMethod::Stored);
        for (id, image) in jpegs {
            archive.start_file(format!("word/media/{id}.jpeg"), options)?;
            archive.write_all(&image)?;
        }
        archive.finish()?;
    }
    Ok(bytes.into_inner())
}

// 只在构建期间短暂存在、随后整体移入 Docx，变体大小差异无关紧要。
#[allow(clippy::large_enum_variant)]
enum Item {
    Paragraph(Paragraph),
    Table(Table),
}

struct Writer<'a> {
    theme: Theme,
    root: &'a Path,
    report: ExportReport,
    /// 章节引用的目标。
    targets: ChapterTargets,
    /// 图表的编号与引用目标（docs/decisions.md 第 12 节）。
    elements: ElementTargets,
    /// 文献引用的编号（docs/decisions.md 第 13 节）。
    citations: Citations,
    next_numbering: usize,
    numberings: Vec<Numbering>,
    items: Vec<Item>,
}

/// 行内样式的累积状态。
#[derive(Clone, Copy, Default)]
struct RunStyle {
    bold: bool,
    italic: bool,
    strike: bool,
    code: bool,
}

/// 块所处的上下文：列表层级与引用层级决定缩进。
#[derive(Clone, Copy, Default)]
struct BlockContext {
    list_level: usize,
    quote_level: usize,
    in_list: bool,
}

impl Writer<'_> {
    /// 参考文献表（docs/decisions.md 第 13 节）：正文之后一个不编号的一级标题（Heading 1，另起一页），
    /// 按编号列出被引用的条目（Bibliography 样式，悬挂缩进），每条带书签供文献引用跳转。
    fn bibliography(&mut self) {
        if self.citations.is_empty() {
            return;
        }
        let heading = heading(1).add_run(Run::new().add_text(BIBLIOGRAPHY_TITLE));
        self.items.push(Item::Paragraph(heading));
        let entries: Vec<(usize, String)> = self.citations.list().map(|(n, text)| (n, text.to_owned())).collect();
        for (number, text) in entries {
            let id = CITATION_BOOKMARK_BASE + number;
            let p = Paragraph::new()
                .style("Bibliography")
                .add_bookmark_start(id, citation_bookmark(number))
                .add_run(Run::new().add_text(xml_safe(&format!("[{number}]\t{text}"))))
                .add_bookmark_end(id);
            self.items.push(Item::Paragraph(p));
        }
    }

    fn section(&mut self, section: &Section) {
        let level = section.depth.clamp(1, MAX_HEADING);
        let text = if section.number.is_empty() {
            section.title.clone()
        } else {
            format!("{} {}", section.number, section.title)
        };
        let mut paragraph = heading(level);
        // 书签供章节引用跳转。
        let bookmark = self.targets.by_id(&section.chapter_id).map(|t| t.index);
        if let Some(index) = bookmark {
            paragraph = paragraph.add_bookmark_start(index, chapter_bookmark(index));
        }
        paragraph = paragraph.add_run(Run::new().add_text(xml_safe(&text)));
        if let Some(index) = bookmark {
            paragraph = paragraph.add_bookmark_end(index);
        }
        self.items.push(Item::Paragraph(paragraph));
        for block in &section.blocks {
            self.block(block, section, BlockContext::default());
        }
    }

    fn block(&mut self, block: &Block, section: &Section, context: BlockContext) {
        let element = self.elements.of(block).cloned();
        if let Some((src, alt)) = block.as_figure() {
            self.figure(src, alt, element.as_ref(), context);
            return;
        }
        match block {
            Block::Paragraph(inlines) => {
                let p = self.paragraph_for(context);
                let p = self.inlines(p, inlines, RunStyle::default(), text_bounds(content_width_pt(context, 0)));
                self.items.push(Item::Paragraph(p));
            }
            Block::List {
                ordered,
                start,
                items,
            } => self.list(*ordered, *start, items, section, context),
            Block::Quote(blocks) => {
                let inner = BlockContext {
                    quote_level: context.quote_level + 1,
                    ..context
                };
                for block in blocks {
                    self.block(block, section, inner);
                }
            }
            Block::Code { text, .. } => {
                let mut run = Run::new()
                    .fonts(fonts(FontFamily::Mono))
                    .size(half_points(self.theme.code_block));
                for (i, line) in text.split('\n').enumerate() {
                    if i > 0 {
                        run = run.add_break(BreakType::TextWrapping);
                    }
                    run = run.add_text(xml_safe(line));
                }
                let mut p = self
                    .indent(Paragraph::new().style("Code"), context)
                    .add_run(run);
                // 与 PDF 一致的浅灰底色。
                p.property = p
                    .property
                    .shading(Shading::new().shd_type(ShdType::Clear).fill(CODE_FILL));
                self.items.push(Item::Paragraph(p));
            }
            Block::Table {
                alignments,
                header,
                rows,
                caption,
            } => {
                // 表格标题在表格上方（Caption 样式），与表格留在同一页；有编号时前面是编号并带书签。
                if let (Some(caption), Some(target)) = (caption, &element) {
                    let text = format!("{}{ELEMENT_SEPARATOR}{}", target.label, caption.text);
                    let p = self.caption_paragraph(&text, target, context).keep_next(true);
                    self.items.push(Item::Paragraph(p));
                }
                self.table(alignments, header, rows)
            }
            Block::Rule => self
                .items
                .push(Item::Paragraph(short_rule(0.3, 4, RULE_COLOR))),
        }
    }

    /// 普通段落：正文使用 Body Text（首行缩进），列表中使用 List Paragraph，引用中使用 Quote，
    /// 并按列表 / 引用层级缩进。
    fn paragraph_for(&self, context: BlockContext) -> Paragraph {
        let style = if context.quote_level > 0 {
            "Quote"
        } else if context.in_list {
            "ListParagraph"
        } else {
            "BodyText"
        };
        self.indent(Paragraph::new().style(style), context)
    }

    fn indent(&self, p: Paragraph, context: BlockContext) -> Paragraph {
        let left = LIST_INDENT * (context.list_level as i32 + context.quote_level as i32);
        if left == 0 {
            p
        } else {
            p.indent(Some(left), None, None, None)
        }
    }

    fn list(
        &mut self,
        ordered: bool,
        start: u64,
        items: &[Vec<Block>],
        section: &Section,
        context: BlockContext,
    ) {
        // 编号定义只有 0..=8 级；更深的嵌套列表停留在第 8 级，避免引用未定义的级别。
        let level = if context.in_list {
            context.list_level.min(MAX_HEADING - 1)
        } else {
            0
        };
        let numbering_id = if ordered {
            // 每个有序列表一个编号实例，从自己的起始值开始，互不接续。
            let id = self.next_numbering;
            self.next_numbering += 1;
            let start = usize::try_from(start).unwrap_or(1).max(1);
            self.numberings.push(
                Numbering::new(id, DECIMAL_ABSTRACT)
                    .add_override(LevelOverride::new(level).start(start)),
            );
            id
        } else {
            BULLET_NUMBERING
        };

        for item in items {
            let mut first = true;
            for block in item {
                match block {
                    Block::Paragraph(inlines) if first => {
                        let p = Paragraph::new()
                            .style(if context.quote_level > 0 {
                                "Quote"
                            } else {
                                "ListParagraph"
                            })
                            .numbering(NumberingId::new(numbering_id), IndentLevel::new(level));
                        let bounds = text_bounds(content_width_pt(context, level + 1));
                        let p = self.inlines(p, inlines, RunStyle::default(), bounds);
                        self.items.push(Item::Paragraph(p));
                    }
                    Block::List { .. } => {
                        let nested = BlockContext {
                            list_level: level + 1,
                            in_list: true,
                            ..context
                        };
                        self.block(block, section, nested);
                    }
                    other => {
                        let nested = BlockContext {
                            list_level: level + 1,
                            in_list: true,
                            ..context
                        };
                        self.block(other, section, nested);
                    }
                }
                first = false;
            }
        }
    }

    fn table(&mut self, alignments: &[Align], header: &[Vec<Inline>], rows: &[Vec<Vec<Inline>>]) {
        let columns = header
            .len()
            .max(rows.iter().map(Vec::len).max().unwrap_or(0))
            .max(1);
        let width = TEXT_WIDTH as usize / columns;
        // 单元格中的图片不超过单元格去掉左右内边距后的宽度（各列等宽）。
        let cell_width = f64::from((width as u32).saturating_sub(2 * CELL_MARGIN)) / 20.0;
        // 高度：含图片的行不能跨页拆开，而表头在每页重复。Word 的排版结果无法在导出时测量，
        // 因此按表头文字折行的上限估计表头高度（表头中的图片另有上限），正文行中的图片不超过
        // 正文区减去表头与单元格段落间距。
        let text_height = f64::from(TEXT_HEIGHT) / 20.0;
        let head_bounds = Bounds {
            width: cell_width,
            height: text_height * HEADER_IMAGE_SHARE,
        };
        let table_size = self.theme.table;
        let head_height = header
            .iter()
            .map(|cell| {
                let text = crate::render::markdown::plain_text(cell);
                let image = if has_image(cell) { head_bounds.height } else { 0.0 };
                text_height_pt(&text, table_size, table_size * 1.5, cell_width) + image
            })
            .fold(0.0, f64::max)
            + TABLE_TEXT_SPACING_PT;
        let body_bounds = Bounds {
            width: cell_width,
            height: text_height - head_height - TABLE_TEXT_SPACING_PT - IMAGE_HEIGHT_SLACK,
        };
        let bold = RunStyle {
            bold: true,
            ..RunStyle::default()
        };
        let make_row =
            |writer: &mut Self, cells: &[Vec<Inline>], style: RunStyle, is_header: bool| {
                let cells = (0..columns)
                    .map(|i| {
                        let mut p = Paragraph::new().style("TableText");
                        p = match alignments.get(i) {
                            Some(Align::Center) => p.align(AlignmentType::Center),
                            Some(Align::Right) => p.align(AlignmentType::Right),
                            _ => p,
                        };
                        let inlines = cells.get(i).map_or(&[][..], Vec::as_slice);
                        let bounds = if is_header { head_bounds } else { body_bounds };
                        let p = writer.inlines(p, inlines, style, bounds);
                        let cell = TableCell::new()
                            .add_paragraph(p)
                            .width(width, WidthType::Dxa);
                        // 三线表：表头下方一条细线。
                        if is_header {
                            cell.set_borders(
                                TableCellBorders::with_empty().set(
                                    TableCellBorder::new(TableCellBorderPosition::Bottom)
                                        .border_type(BorderType::Single)
                                        .size(4)
                                        .color("000000"),
                                ),
                            )
                        } else {
                            cell
                        }
                    })
                    .collect();
                // 表头行不跨页拆分，并在每一页重复（见 mark_header_rows）。
                if is_header {
                    TableRow::new(cells).cant_split()
                } else {
                    TableRow::new(cells)
                }
            };
        let mut table_rows = vec![make_row(self, header, bold, true)];
        for row in rows {
            table_rows.push(make_row(self, row, RunStyle::default(), false));
        }
        // 三线表：顶线与底线 1 磅，无竖线与内部横线（与 PDF 默认一致）。
        let rule = |position| {
            TableBorder::new(position)
                .border_type(BorderType::Single)
                .size(8)
                .color("000000")
        };
        let table = Table::new(table_rows)
            .set_grid(vec![width; columns])
            .width(TEXT_WIDTH as usize, WidthType::Dxa)
            .set_borders(
                TableBorders::with_empty()
                    .set(rule(TableBorderPosition::Top))
                    .set(rule(TableBorderPosition::Bottom)),
            );
        self.items.push(Item::Table(table));
        // 紧跟的段落与表格之间留出间距。
        self.items.push(Item::Paragraph(Paragraph::new()));
    }

    /// 独立成段的图片：居中；有图注时图注紧随其后，两者保持在同一页。
    /// 尺寸上限是完整正文区（不是当前页剩余空间）扣除图片前后间距与图注占用的高度。
    /// 图注 / 表格标题段落：Caption 样式；有编号的图表带书签（图表引用的跳转目标）。
    fn caption_paragraph(&self, text: &str, target: &ElementTarget, context: BlockContext) -> Paragraph {
        let id = ELEMENT_BOOKMARK_BASE + target.anchor;
        self.indent(Paragraph::new().style("Caption"), context)
            .add_bookmark_start(id, element_bookmark(target.anchor))
            .add_run(Run::new().add_text(xml_safe(text)))
            .add_bookmark_end(id)
    }

    fn figure(&mut self, src: &str, alt: &str, element: Option<&ElementTarget>, context: BlockContext) {
        let caption = match element {
            Some(target) => format!("{}{ELEMENT_SEPARATOR}{alt}", target.label),
            None => alt.to_owned(),
        };
        // 图片无法显示时的占位文字仍用原来的图注。
        let image_alt = alt;
        let alt = caption.as_str();
        let theme = &self.theme;
        let spacing_pt = theme.image_spacing * theme.body.size;
        let spacing = twips(spacing_pt);
        let width = content_width_pt(context, 0);
        let mut reserved = spacing_pt * 2.0 + IMAGE_HEIGHT_SLACK;
        if !alt.is_empty() {
            // 图注段落沿用正文的"最小行距"，每行至少一个正文行距；Word 中无法测量，按折行上限预留。
            let pitch = (theme.body.size * theme.body.line_height).max(theme.caption.size * 1.5);
            reserved += text_height_pt(alt, theme.caption.size, pitch, width);
        }
        let bounds = Bounds {
            width,
            height: f64::from(TEXT_HEIGHT) / 20.0 - reserved,
        };
        let image_spacing = LineSpacing::new()
            .before(spacing)
            .after(if alt.is_empty() { spacing } else { 0 });
        let p = self
            .indent(Paragraph::new().align(AlignmentType::Center), context)
            .line_spacing(image_spacing);
        // 图片与下面的图注留在同一页。
        let p = p
            .keep_next(!alt.is_empty())
            .add_run(self.image_run(src, image_alt, bounds));
        self.items.push(Item::Paragraph(p));
        if !alt.is_empty() {
            let caption = match element {
                Some(target) => self.caption_paragraph(alt, target, context),
                None => self
                    .indent(Paragraph::new().style("Caption"), context)
                    .add_run(Run::new().add_text(xml_safe(alt))),
            };
            self.items.push(Item::Paragraph(caption.line_spacing(LineSpacing::new().after(spacing))));
        }
    }

    fn image_run(&mut self, src: &str, alt: &str, bounds: Bounds) -> Run {
        let image = resolve_image(self.root, src).and_then(|path| load_for_export(&path));
        let Some(image) = image else {
            self.report.missing_images.push(src.to_owned());
            let label = if alt.is_empty() { src } else { alt };
            return Run::new()
                .color("B91C1C")
                .add_text(xml_safe(&format!("[图片无法显示：{label}]")));
        };
        let (width, height) = display_size_pt(image.width, image.height, bounds);
        let pic = Pic::new_with_dimensions(image.bytes, image.width, image.height)
            .size(pt_to_emu(width), pt_to_emu(height));
        Run::new().add_image(pic)
    }

    /// 行内内容；bounds 是所在容器（段落、表格单元格）中图片的宽度与高度上限（磅）。
    fn inlines(
        &mut self,
        mut p: Paragraph,
        inlines: &[Inline],
        style: RunStyle,
        bounds: Bounds,
    ) -> Paragraph {
        for inline in inlines {
            p = match inline {
                Inline::Text(text) => p.add_run(styled(Run::new().add_text(xml_safe(text)), style)),
                // 章节引用：按当前结构生成文字并链接到目标章节标题的书签；失效引用输出链接文字（列入导出报告）。
                Inline::ChapterRef { target, cached } => match self.targets.get(target) {
                    Some(chapter) => {
                        let number = (!chapter.number.is_empty()).then_some(chapter.number.as_str());
                        let show = target.as_ref().map_or(RefShow::NumberTitle, |t| t.show);
                        let text = ref_text(number, &chapter.title, show);
                        let run = styled(Run::new().add_text(xml_safe(&text)), style).color(LINK_COLOR);
                        p.add_hyperlink(
                            Hyperlink::new(chapter_bookmark(chapter.index), HyperlinkType::Anchor)
                                .add_run(run),
                        )
                    }
                    None => p.add_run(styled(Run::new().add_text(xml_safe(cached)), style)),
                },
                // 文献引用：上标的“[编号]”，链接到参考文献表中条目的书签；条目不存在时输出链接文字（列入导出报告）。
                Inline::Citation { id, cached } => match self.citations.number(id) {
                    Some(number) => {
                        let mut run = styled(Run::new().add_text(format!("[{number}]")), style);
                        run.run_property = run.run_property.vert_align(VertAlignType::SuperScript);
                        p.add_hyperlink(Hyperlink::new(citation_bookmark(number), HyperlinkType::Anchor).add_run(run))
                    }
                    None => p.add_run(styled(Run::new().add_text(xml_safe(cached)), style)),
                },
                // 图表引用：编号文字，链接到图注 / 表格标题上的书签；失效引用输出链接文字（列入导出报告）。
                Inline::ElementRef { kind, id, cached } => match self.elements.get(*kind, id) {
                    Some(target) => {
                        let run = styled(Run::new().add_text(xml_safe(&target.label)), style).color(LINK_COLOR);
                        p.add_hyperlink(
                            Hyperlink::new(element_bookmark(target.anchor), HyperlinkType::Anchor).add_run(run),
                        )
                    }
                    None => p.add_run(styled(Run::new().add_text(xml_safe(cached)), style)),
                },
                Inline::Strong(children) => self.inlines(
                    p,
                    children,
                    RunStyle {
                        bold: true,
                        ..style
                    },
                    bounds,
                ),
                Inline::Emphasis(children) => self.inlines(
                    p,
                    children,
                    RunStyle {
                        italic: true,
                        ..style
                    },
                    bounds,
                ),
                Inline::Strike(children) => self.inlines(
                    p,
                    children,
                    RunStyle {
                        strike: true,
                        ..style
                    },
                    bounds,
                ),
                Inline::Code(code) => p.add_run(styled(
                    Run::new().add_text(xml_safe(code)),
                    RunStyle {
                        code: true,
                        ..style
                    },
                )),
                Inline::Link { url, children } => {
                    let text = crate::render::markdown::plain_text(children);
                    let run = styled(Run::new().add_text(xml_safe(&text)), style).color(LINK_COLOR);
                    if is_safe_url(url) {
                        p.add_hyperlink(
                            Hyperlink::new(url.as_str(), HyperlinkType::External).add_run(run),
                        )
                    } else {
                        p.add_run(run)
                    }
                }
                Inline::Image { src, alt, .. } => {
                    // 与文字同段的图片：不超过所在容器的宽度与高度上限。
                    let run = self.image_run(src, alt, bounds);
                    p.add_run(run)
                }
                // 脚注：Word 的脚注（页底，自动编号）。内容段落以编号标记开头（见 footnote_marks）。
                Inline::Footnote(content) => {
                    let mut text = Paragraph::new()
                        .style("FootnoteText")
                        .add_run(Run::new().style("FootnoteReference").add_text(FOOTNOTE_MARK_TEXT))
                        .add_run(Run::new().add_text(" "));
                    text = self.inlines(text, content, RunStyle::default(), bounds);
                    let mut footnote = Footnote::new();
                    footnote.add_content(text);
                    p.add_run(Run::new().add_footnote_reference(footnote))
                }
                Inline::SoftBreak => p.add_run(styled(Run::new().add_text(" "), style)),
                Inline::HardBreak => p.add_run(Run::new().add_break(BreakType::TextWrapping)),
            };
        }
        p
    }
}

fn styled(mut run: Run, style: RunStyle) -> Run {
    if style.bold {
        run = run.bold();
    }
    if style.italic {
        run = run.italic();
    }
    if style.strike {
        run = run.strike();
    }
    if style.code {
        run = run
            .fonts(fonts(FontFamily::Mono))
            .size(half_points(Theme::default().body.size * 0.9))
            .shading(
                Shading::new()
                    .shd_type(ShdType::Clear)
                    .fill(INLINE_CODE_FILL),
            );
    }
    run
}

fn fonts(family: impl Into<FontFamily>) -> RunFonts {
    let names = docx_fonts(family.into());
    RunFonts::new()
        .ascii(names.latin)
        .hi_ansi(names.latin)
        .cs(names.latin)
        .east_asia(names.east_asia)
}

/// 只把 http(s) / mailto 链接写成超链接；其余（相对路径、javascript: 等）只保留文字。
/// URL 写入关系文件的属性中，含引号、尖括号等字符时同样只保留文字。
fn is_safe_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    (lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:"))
        && !url
            .chars()
            .any(|c| c.is_control() || matches!(c, '"' | '<' | '>' | '\'' | '&' | ' '))
}

/// 去掉 XML 1.0 不允许的字符（除 \t \n \r 外的 C0 控制字符、U+FFFE、U+FFFF）。
pub fn xml_safe(text: &str) -> String {
    text.chars()
        .filter(|&c| {
            matches!(c, '\t' | '\n' | '\r') || (c >= ' ' && c != '\u{FFFE}' && c != '\u{FFFF}')
        })
        .collect()
}

fn base_document(theme: &Theme, title: &str, cover: bool) -> Docx {
    let body = &theme.body;
    // 行距：相邻基线距离 = 字号 × 行距倍数。用"最小值"而不是"固定值"：行内图片等较高的内容不会被裁掉。
    let body_line = LineSpacing::new()
        .line_rule(LineSpacingType::AtLeast)
        .line(twips(body.size * body.line_height) as i32)
        .after(twips(body.size * body.paragraph_spacing));

    let mut docx = Docx::new()
        .page_size(PAGE_WIDTH, PAGE_HEIGHT)
        .page_margin(
            PageMargin::new()
                .top(MARGIN)
                .bottom(MARGIN)
                .left(MARGIN)
                .right(MARGIN)
                .header(720)
                .footer(720),
        )
        .default_fonts(fonts(body.font))
        .default_size(half_points(body.size))
        .default_line_spacing(body_line)
        .footer(
            Footer::new().add_paragraph(
                Paragraph::new()
                    .style("Footer")
                    .align(AlignmentType::Center)
                    .add_page_num(PageNum::new()),
            ),
        );
    // 页眉：文档标题，下接细线。
    if !title.is_empty() {
        let mut p = Paragraph::new()
            .style("Header")
            .add_run(Run::new().add_text(xml_safe(title)));
        p.property = p.property.set_borders(
            ParagraphBorders::with_empty().set(
                ParagraphBorder::new(ParagraphBorderPosition::Bottom)
                    .val(BorderType::Single)
                    .size(3)
                    .space(4)
                    .color(RULE_COLOR),
            ),
        );
        docx = docx.header(Header::new().add_paragraph(p));
    }
    // 封面不显示页眉和页码，并记为第 0 页，正文从第 1 页开始。
    if cover {
        docx = docx
            .first_header(Header::new().add_paragraph(Paragraph::new()))
            .first_footer(Footer::new().add_paragraph(Paragraph::new()))
            .page_num_type(PageNumType::new().start(0));
    }

    let mut quote = Style::new("Quote", StyleType::Paragraph)
        .name("Quote")
        .based_on("Normal")
        .fonts(fonts(theme.blockquote.font))
        .size(half_points(theme.blockquote.size))
        .color(QUOTE_COLOR)
        .align(AlignmentType::Both)
        .indent(Some(LIST_INDENT), None, None, None)
        // 与前后的正文、表格隔开；相邻的引用段落之间同样留出间距。
        .line_spacing(
            LineSpacing::new()
                .before(twips(body.size * 0.5))
                .after(twips(body.size * 0.5)),
        );
    // 左侧 2 磅浅灰竖线。
    quote.paragraph_property = quote.paragraph_property.set_borders(
        ParagraphBorders::with_empty().set(
            ParagraphBorder::new(ParagraphBorderPosition::Left)
                .val(BorderType::Single)
                .size(16)
                .space(8)
                .color(QUOTE_BAR_COLOR),
        ),
    );

    // 页眉、页脚：内置 header / footer 样式，9 磅灰色无衬线。
    for (id, name) in [("Header", "header"), ("Footer", "footer")] {
        docx = docx.add_style(
            Style::new(id, StyleType::Paragraph)
                .name(name)
                .based_on("Normal")
                .fonts(fonts(FontFamily::Sans))
                .size(half_points(META_PT))
                .color(META_COLOR),
        );
    }

    docx = docx
        .add_style(
            Style::new("Title", StyleType::Paragraph)
                .name("Title")
                .based_on("Normal")
                .next("Normal")
                .fonts(fonts(theme.title.font))
                .size(half_points(theme.title.size))
                .bold()
                .align(AlignmentType::Center)
                .line_spacing(LineSpacing::new().before(COVER_TOP))
                .q_format(true),
        )
        .add_style(
            Style::new("Subtitle", StyleType::Paragraph)
                .name("Subtitle")
                .based_on("Normal")
                .fonts(fonts(theme.title.font))
                .size(half_points(SUBTITLE_PT))
                .color(INFO_COLOR)
                .align(AlignmentType::Center)
                .line_spacing(LineSpacing::new().before(twips(body.size * 1.2)))
                .q_format(true),
        )
        .add_style(
            Style::new("Author", StyleType::Paragraph)
                .name("Author")
                .based_on("Normal")
                .fonts(fonts(theme.title.font))
                .size(half_points(body.size))
                .color(INFO_COLOR)
                .align(AlignmentType::Center)
                .line_spacing(LineSpacing::new().before(twips(body.size * 3.0))),
        )
        .add_style(
            // 正文段落：两端对齐，首行缩进 2 字符。
            Style::new("BodyText", StyleType::Paragraph)
                .name("Body Text")
                .based_on("Normal")
                .align(AlignmentType::Both)
                .indent(
                    None,
                    Some(SpecialIndentType::FirstLine(twips(body.size * 2.0) as i32)),
                    None,
                    None,
                )
                .q_format(true),
        )
        .add_style(
            Style::new("ListParagraph", StyleType::Paragraph)
                .name("List Paragraph")
                .based_on("Normal")
                .align(AlignmentType::Both)
                .q_format(true),
        )
        .add_style(
            Style::new("Code", StyleType::Paragraph)
                .name("Code")
                .based_on("Normal")
                .fonts(fonts(FontFamily::Mono))
                .size(half_points(theme.code_block))
                .line_spacing(
                    LineSpacing::new()
                        .line_rule(LineSpacingType::Auto)
                        .line(276)
                        .before(twips(body.size * 0.5))
                        .after(twips(body.size * 0.5)),
                ),
        )
        .add_style(quote)
        .add_style(
            Style::new("TableText", StyleType::Paragraph)
                .name("Table Text")
                .based_on("Normal")
                .size(half_points(theme.table))
                .line_spacing(
                    LineSpacing::new()
                        .line_rule(LineSpacingType::Auto)
                        .line(276)
                        .before(40)
                        .after(40),
                ),
        )
        .add_style(
            // 参考文献条目：编号与著录文字之间是制表位，换行后与著录文字对齐（悬挂缩进）。
            Style::new("Bibliography", StyleType::Paragraph)
                .name("Bibliography")
                .based_on("Normal")
                .align(AlignmentType::Both)
                .indent(Some(BIBLIOGRAPHY_INDENT), Some(SpecialIndentType::Hanging(BIBLIOGRAPHY_INDENT)), None, None),
        )
        .add_style(
            Style::new("FootnoteText", StyleType::Paragraph)
                .name("footnote text")
                .based_on("Normal")
                .size(half_points(META_PT))
                .align(AlignmentType::Both),
        )
        .add_style({
            let mut style = Style::new("FootnoteReference", StyleType::Character).name("footnote reference");
            style.run_property = style.run_property.vert_align(VertAlignType::SuperScript);
            style
        })
        .add_style(
            Style::new("Caption", StyleType::Paragraph)
                .name("caption")
                .based_on("Normal")
                .fonts(fonts(theme.caption.font))
                .size(half_points(theme.caption.size))
                .color(META_COLOR)
                .align(AlignmentType::Center),
        );

    for level in 1..=MAX_HEADING {
        let heading = theme.heading(level);
        // 一级章节另起一页，标题上方留白。
        let before = if level == 1 {
            twips(CHAPTER_TOP_PT)
        } else {
            twips(heading.size * heading.spacing_before)
        };
        let mut style = Style::new(format!("Heading{level}"), StyleType::Paragraph)
            .name(format!("heading {level}"))
            .based_on("Normal")
            .next("BodyText")
            .fonts(fonts(heading.font))
            .size(half_points(heading.size))
            .bold()
            .outline_lvl(level - 1)
            .line_spacing(
                LineSpacing::new()
                    .line_rule(LineSpacingType::Auto)
                    .line(288)
                    .before(before)
                    .after(twips(heading.size * heading.spacing_after)),
            )
            .q_format(true);
        if level == 1 {
            style.paragraph_property = style.paragraph_property.page_break_before(true);
        }
        docx = docx.add_style(style);
    }

    let bullets = ["•", "◦", "▪"];
    let mut bullet = AbstractNumbering::new(BULLET_ABSTRACT);
    let mut decimal = AbstractNumbering::new(DECIMAL_ABSTRACT);
    for level in 0..MAX_HEADING {
        let indent = LIST_INDENT * (level as i32 + 1);
        bullet = bullet.add_level(
            Level::new(
                level,
                Start::new(1),
                NumberFormat::new("bullet"),
                LevelText::new(bullets[level % 3]),
                LevelJc::new("left"),
            )
            .indent(
                Some(indent),
                Some(SpecialIndentType::Hanging(LIST_INDENT)),
                None,
                None,
            ),
        );
        decimal = decimal.add_level(
            Level::new(
                level,
                Start::new(1),
                NumberFormat::new("decimal"),
                LevelText::new(format!("%{}.", level + 1)),
                LevelJc::new("left"),
            )
            .indent(
                Some(indent),
                Some(SpecialIndentType::Hanging(LIST_INDENT)),
                None,
                None,
            ),
        );
    }
    docx.add_abstract_numbering(bullet)
        .add_abstract_numbering(decimal)
        .add_numbering(Numbering::new(BULLET_NUMBERING, BULLET_ABSTRACT))
}

/// 章节标题的书签名（章节引用的跳转目标）。下划线开头是 Word 的隐藏书签，不出现在书签列表中。
/// 图表编号与图注 / 标题之间的分隔（全角空格，与 PDF 相同）。
const ELEMENT_SEPARATOR: &str = "\u{3000}";
/// 参考文献条目的悬挂缩进（twip，约 2.5 字）。
const BIBLIOGRAPHY_INDENT: i32 = 600;

/// 参考文献表的标题（输出中的文字）。
const BIBLIOGRAPHY_TITLE: &str = "参考文献";
/// 文献书签的 id 从这里开始，不与章节、图表书签重复。
const CITATION_BOOKMARK_BASE: usize = 2_000_000;

fn citation_bookmark(number: usize) -> String {
    format!("_WriterCite{number}")
}

/// 图表书签的 id 从这里开始，不与章节书签（按章节序号）重复。
const ELEMENT_BOOKMARK_BASE: usize = 1_000_000;

fn element_bookmark(anchor: usize) -> String {
    format!("_WriterElement{anchor}")
}

fn chapter_bookmark(index: usize) -> String {
    format!("_WriterChapter{index}")
}

/// 标题段落：与下一段落留在同一页，标题本身不跨页拆开，避免标题孤零零地留在页面底部。
fn heading(level: usize) -> Paragraph {
    Paragraph::new()
        .style(&format!("Heading{level}"))
        .keep_next(true)
        .keep_lines(true)
}

/// 居中的短细线：占正文宽度的 fraction，size 以 1/8 磅计。
fn short_rule(fraction: f64, size: usize, color: &str) -> Paragraph {
    let side = (f64::from(TEXT_WIDTH) * (1.0 - fraction) / 2.0).round() as i32;
    let mut p = Paragraph::new().indent(Some(side), None, Some(side), None);
    p.property = p.property.set_borders(
        ParagraphBorders::with_empty().set(
            ParagraphBorder::new(ParagraphBorderPosition::Bottom)
                .val(BorderType::Single)
                .size(size)
                .color(color),
        ),
    );
    p
}

/// 让表头行在表格跨页时于每页重复。docx-rs 没有 tblHeader 的接口：
/// 只有表头行带 cantSplit，这里在它旁边补上 tblHeader（trPr 的子元素顺序不限）。
fn mark_header_rows(document: &[u8]) -> Vec<u8> {
    String::from_utf8_lossy(document)
        .replace("<w:cantSplit />", "<w:cantSplit /><w:tblHeader />")
        .into_bytes()
}

/// 正文中的段落与标题：给定宽度、完整正文区高度。
fn text_bounds(width: f64) -> Bounds {
    Bounds {
        width,
        height: f64::from(TEXT_HEIGHT) / 20.0 - IMAGE_HEIGHT_SLACK,
    }
}

fn has_image(inlines: &[Inline]) -> bool {
    inlines.iter().any(|inline| match inline {
        Inline::Image { .. } => true,
        Inline::Strong(c) | Inline::Emphasis(c) | Inline::Strike(c) => has_image(c),
        Inline::Link { children, .. } => has_image(children),
        _ => false,
    })
}

/// 块内容的可用宽度（磅）：正文宽度减去引用与列表的缩进。list_level 是内容所在的列表缩进层数。
fn content_width_pt(context: BlockContext, list_level: usize) -> f64 {
    let levels = list_level.max(context.list_level) + context.quote_level;
    let indent = f64::from(LIST_INDENT) * levels as f64;
    ((f64::from(TEXT_WIDTH) - indent) / 20.0).max(1.0)
}

fn pt_to_emu(pt: f64) -> u32 {
    (pt * EMU_PER_PT).round() as u32
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::export::images::tests::write_image;
    use crate::render::{build, RenderChapter, RenderRequest};
    use image::ImageFormat;
    use std::fs;
    use std::io::Read;
    use tempfile::TempDir;

    fn request(chapters: &[(&str, Vec<u32>, &str, &str)]) -> RenderRequest {
        RenderRequest {
            title: "示例论文".into(),
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

    /// 解开 docx，返回指定部件的文本。
    fn part(bytes: &[u8], name: &str) -> String {
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        let mut text = String::new();
        archive
            .by_name(name)
            .unwrap()
            .read_to_string(&mut text)
            .unwrap();
        text
    }

    /// 同一种编号定义的 id 不能重复，否则 Word 会认为文件损坏。
    fn assert_unique_ids(xml: &str, prefix: &str) {
        let ids: Vec<&str> = xml
            .split(prefix)
            .skip(1)
            .map(|rest| rest.split('"').next().unwrap())
            .collect();
        let unique: std::collections::BTreeSet<&str> = ids.iter().copied().collect();
        assert_eq!(
            ids.len(),
            unique.len(),
            "duplicate ids for {prefix}: {ids:?}"
        );
    }

    fn media_count(bytes: &[u8]) -> usize {
        let archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        archive
            .file_names()
            .filter(|n| n.starts_with("word/media/") && !n.ends_with('/'))
            .count()
    }

    fn export_ok(
        dir: &TempDir,
        chapters: &[(&str, Vec<u32>, &str, &str)],
    ) -> (Vec<u8>, ExportReport) {
        let (bytes, report) = export(&build(&request(chapters)), dir.path()).unwrap();
        // docx-rs 自带的读取器能完整解析，作为结构合法性的基本检查。
        docx_rs::read_docx(&bytes).expect("generated docx must be readable");
        (bytes, report)
    }

    #[test]
    fn headings_use_builtin_styles_with_numbers() {
        let dir = project();
        let (bytes, report) = export_ok(
            &dir,
            &[
                ("a", vec![1], "绪论", "正文第一段。\n\n## 小节"),
                ("b", vec![1, 2], "研究方法", ""),
            ],
        );
        let xml = part(&bytes, "word/document.xml");
        assert!(xml.contains(r#"<w:pStyle w:val="Title" />"#));
        assert!(xml.contains("示例论文"));
        assert!(xml.contains(r#"<w:pStyle w:val="Heading1" />"#));
        assert!(xml.contains("1 绪论"));
        assert!(xml.contains(r#"<w:pStyle w:val="Heading2" />"#));
        assert!(xml.contains("1.2 研究方法"));
        // 正文不支持标题：## 是普通段落中的文字。
        assert!(!xml.contains(r#"<w:pStyle w:val="Heading3" />"#));
        assert!(xml.contains("## 小节"));
        assert!(xml.contains("正文第一段。"));
        let styles = part(&bytes, "word/styles.xml");
        assert!(styles.contains(r#"w:styleId="Heading1""#));
        assert!(styles.contains(r#"<w:outlineLvl w:val="0" />"#));
        assert!(styles.contains(r#"w:eastAsia="SimHei""#));
        assert!(report.missing_images.is_empty());
    }

    #[test]
    fn subtitle_and_author_follow_the_title_and_fill_document_properties() {
        let dir = project();
        let mut request = request(&[("a", vec![1], "绪论", "")]);
        request.subtitle = "一项研究".into();
        request.author = "张三 & <李四>".into();
        let (bytes, _) = export(&build(&request), dir.path()).unwrap();
        docx_rs::read_docx(&bytes).expect("generated docx must be readable");
        let xml = part(&bytes, "word/document.xml");
        let title = xml.find("示例论文").unwrap();
        let subtitle = xml.find("一项研究").unwrap();
        let author = xml.find("张三 &amp; &lt;李四&gt;").unwrap();
        assert!(title < subtitle && subtitle < author);
        assert!(xml.contains(r#"<w:pStyle w:val="Subtitle" />"#));
        assert!(xml.contains(r#"<w:pStyle w:val="Author" />"#));
        let core = part(&bytes, "docProps/core.xml");
        assert!(core.contains("<dc:title>示例论文</dc:title>"), "{core}");
        assert!(core.contains("<dc:creator>张三 &amp; &lt;李四&gt;</dc:creator>"), "{core}");
        assert!(!core.contains("unknown"), "{core}");

        // 没有副标题与作者时不输出空段落，文档属性也不写作者。
        let (bytes, _) = export_ok(&dir, &[("a", vec![1], "绪论", "")]);
        let xml = part(&bytes, "word/document.xml");
        assert!(!xml.contains(r#"<w:pStyle w:val="Subtitle" />"#));
        assert!(!xml.contains(r#"<w:pStyle w:val="Author" />"#));
        assert!(!part(&bytes, "docProps/core.xml").contains("dc:creator"));
    }

    #[test]
    fn figures_and_tables_are_numbered_with_bookmarks_and_references_link_to_them() {
        let dir = project();
        let (bytes, report) = export_ok(
            &dir,
            &[
                ("a", vec![1], "绪论", "见[旧](writer:figure/f1)与[旧](writer:table/t1)；[原表](writer:table/gone)。"),
                ("b", vec![2], "方法", "![流程](missing.png \"fig:f1\")\n\nTable: 样本 {#tbl:t1}\n\n| 组 |\n| - |\n| 甲 |"),
            ],
        );
        let xml = part(&bytes, "word/document.xml");
        assert!(xml.contains("图 2-1\u{3000}流程") && xml.contains("表 2-1\u{3000}样本"), "{xml}");
        assert!(xml.contains(r#"w:name="_WriterElement0""#) && xml.contains(r#"w:name="_WriterElement1""#));
        assert!(xml.contains(r#"w:anchor="_WriterElement0""#) && xml.contains(r#"w:anchor="_WriterElement1""#));
        // 表格标题在表格之前。
        assert!(xml.find("表 2-1").unwrap() < xml.find("<w:tbl>").unwrap());
        assert_eq!(report.broken_references, vec!["原表"]);
    }

    #[test]
    fn citations_link_to_a_bibliography_after_the_body() {
        let dir = project();
        let mut request = request(&[("a", vec![1], "绪论", "见[[x]](writer:cite/b)与[[y]](writer:cite/a)。")]);
        request.references = vec![
            crate::render::RenderReference { id: "a".into(), text: "甲. 书[M]. 2020.".into() },
            crate::render::RenderReference { id: "b".into(), text: "乙. 文[J]. 2021.".into() },
        ];
        let (bytes, _) = export(&build(&request), dir.path()).unwrap();
        docx_rs::read_docx(&bytes).expect("generated docx must be readable");
        let xml = part(&bytes, "word/document.xml");
        assert!(xml.contains(r#"w:anchor="_WriterCite1""#) && xml.contains(r#"w:anchor="_WriterCite2""#));
        assert!(xml.contains(r#"<w:vertAlign w:val="superscript" />"#));
        let heading = xml.find("参考文献").unwrap();
        assert!(xml.find("[1]\t乙. 文[J]. 2021.").unwrap() > heading, "{xml}");
        assert!(xml.find("[2]\t甲. 书[M]. 2020.").unwrap() > heading);
        assert!(xml.contains(r#"w:name="_WriterCite1""#));
        assert!(part(&bytes, "word/styles.xml").contains(r#"w:styleId="Bibliography""#));
    }

    #[test]
    fn footnotes_become_word_footnotes_with_number_marks() {
        let dir = project();
        let (bytes, _) = export_ok(&dir, &[("a", vec![1], "绪论", "正文[^a]与[^b]。\n\n[^a]: 脚注**甲**\n\n[^b]: 脚注乙")]);
        docx_rs::read_docx(&bytes).expect("generated docx must be readable");
        let document = part(&bytes, "word/document.xml");
        assert_eq!(document.matches("<w:footnoteReference").count(), 2, "{document}");
        assert!(!document.contains("脚注甲"));
        let footnotes = part(&bytes, "word/footnotes.xml");
        assert_eq!(footnotes.matches("<w:footnoteRef />").count(), 2, "{footnotes}");
        assert!(!footnotes.contains('\u{E000}'));
        assert!(footnotes.contains(r#"<w:pStyle w:val="FootnoteText" />"#));
        assert!(footnotes.contains("甲") && footnotes.contains("<w:b />") && footnotes.contains("脚注乙"));
        let styles = part(&bytes, "word/styles.xml");
        assert!(styles.contains(r#"w:styleId="FootnoteReference""#) && styles.contains(r#"<w:vertAlign w:val="superscript" />"#));
    }

    #[test]
    fn chapter_references_link_to_heading_bookmarks() {
        let dir = project();
        let markdown = "见[旧](writer:chapter/c)、[旧](writer:chapter/b?show=number)；失效：[原目标](writer:chapter/gone)。";
        let (bytes, report) = export_ok(
            &dir,
            &[("a", vec![1], "绪论", markdown), ("b", vec![1, 1], "背景", ""), ("c", vec![2], "方法", "")],
        );
        let xml = part(&bytes, "word/document.xml");
        for index in 0..3 {
            assert!(xml.contains(&format!(r#"<w:bookmarkStart w:id="{index}" w:name="_WriterChapter{index}" />"#)), "{xml}");
            assert!(xml.contains(&format!(r#"<w:bookmarkEnd w:id="{index}" />"#)));
        }
        assert!(xml.contains(r#"<w:hyperlink w:anchor="_WriterChapter2" "#), "{xml}");
        assert!(xml.contains(r#"<w:hyperlink w:anchor="_WriterChapter1" "#));
        assert!(xml.contains(">2 方法</w:t>") && xml.contains(">1.1</w:t>") && xml.contains(">原目标</w:t>"));
        assert!(!xml.contains(">旧</w:t>"));
        assert_eq!(xml.matches("<w:hyperlink").count(), 2);
        assert_eq!(report.broken_references, vec!["原目标"]);
    }

    #[test]
    fn pagination_keeps_headings_with_text_and_repeats_table_headers() {
        let dir = project();
        let (bytes, _) = export_ok(
            &dir,
            &[(
                "a",
                vec![1],
                "绪论",
                "## 小节\n\n正文\n\n| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n\n```\ncode\n```",
            )],
        );
        let xml = part(&bytes, "word/document.xml");
        // 标题（文档标题除外）：章节标题与下一段同页、不拆行；正文中的 ## 只是文字。
        let headings = xml.matches(r#"<w:pStyle w:val="Heading"#).count();
        assert_eq!(headings, 1);
        assert_eq!(xml.matches("<w:keepNext />").count(), headings);
        assert_eq!(xml.matches("<w:keepLines />").count(), headings);
        // 只有表头行在每页重复，且不跨页拆分。
        assert_eq!(xml.matches("<w:tblHeader />").count(), 1);
        assert_eq!(xml.matches("<w:cantSplit />").count(), 1);
        // 代码块有底色。
        assert!(xml.contains(r#"<w:shd w:val="clear" w:color="auto" w:fill="F5F5F5" />"#));
    }

    #[test]
    fn inline_styles_lists_quotes_code_tables() {
        let dir = project();
        let markdown = "**粗**、*斜*、~~删~~、`code`、[链接](https://example.com)\n\n\
                        - 甲\n  1. 子一\n  2. 子二\n- 乙\n\n\
                        3. 三\n4. 四\n\n\
                        > 引用\n\n\
                        ```\nfn main() {\n    println!(\"<>\");\n}\n```\n\n\
                        | 组别 | 数 |\n| --- | --: |\n| 对照 | 30 |\n\n---";
        let (bytes, _) = export_ok(&dir, &[("a", vec![1], "章", markdown)]);
        let xml = part(&bytes, "word/document.xml");
        assert!(xml.contains("<w:b />") && xml.contains("<w:i />") && xml.contains("<w:strike />"));
        assert!(xml.contains("<w:hyperlink"));
        assert!(xml.contains(r#"<w:numId w:val="10" />"#), "bullet list");
        assert!(xml.contains(r#"<w:ilvl w:val="1" />"#), "nested list level");
        assert!(xml.contains(r#"<w:pStyle w:val="Quote" />"#));
        assert!(xml.contains(r#"<w:pStyle w:val="Code" />"#));
        assert!(
            xml.contains("    println!(&quot;&lt;&gt;&quot;);")
                || xml.contains("    println!(\"&lt;&gt;\");")
        );
        assert!(xml.contains("<w:tbl>"));
        assert!(xml.contains("对照"));
        let numbering = part(&bytes, "word/numbering.xml");
        assert!(
            numbering.contains(r#"<w:startOverride w:val="3" />"#),
            "ordered list keeps its start"
        );
        assert_unique_ids(&numbering, r#"<w:num w:numId=""#);
        assert_unique_ids(&numbering, r#"<w:abstractNum w:abstractNumId=""#);
        let rels = part(&bytes, "word/_rels/document.xml.rels");
        assert!(rels.contains("https://example.com"));
    }

    #[test]
    fn jpeg_media_keeps_original_bytes_and_correct_relationships() {
        let dir = project();
        let path = dir.path().join("assets/photo.jpg");
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
        let started = std::time::Instant::now();
        let (bytes, report) = export_ok(
            &dir,
            &[(
                "a",
                vec![1],
                "Photos",
                "![Photo](../assets/photo.jpg)\n\n![Again](../assets/photo.jpg)",
            )],
        );
        println!(
            "JPEG Word: {:?}, {} bytes (source: {})",
            started.elapsed(),
            bytes.len(),
            jpeg.len()
        );
        assert!(report.missing_images.is_empty());
        let mut archive = zip::ZipArchive::new(Cursor::new(&bytes)).unwrap();
        let names: Vec<_> = archive
            .file_names()
            .filter(|name| name.starts_with("word/media/") && !name.ends_with('/'))
            .map(str::to_owned)
            .collect();
        assert_eq!(names.len(), 1, "重复图片只嵌入一次");
        assert!(names[0].ends_with(".jpeg"));
        let mut embedded = Vec::new();
        archive.by_name(&names[0]).unwrap()
            .read_to_end(&mut embedded).unwrap();
        assert_eq!(embedded, jpeg);
        let rels = part(&bytes, "word/_rels/document.xml.rels");
        assert!(rels.contains(&format!(
            "Target=\"{}\"",
            names[0].strip_prefix("word/").unwrap()
        )));
        let content_types = part(&bytes, "[Content_Types].xml");
        assert!(content_types.split("<Default ").skip(1).any(|part| {
            let tag = part.split('>').next().unwrap();
            tag.contains("Extension=\"jpeg\"") && tag.contains("ContentType=\"image/jpeg\"")
        }));
        assert!(bytes.len() < jpeg.len() + 100_000);
        let reopened = docx_rs::read_docx_with_options(
            &bytes,
            docx_rs::ReadDocxOptions::default().with_image_previews(false),
        )
        .unwrap();
        assert_eq!(reopened.images.len(), 1);
        assert_eq!(reopened.images[0].2.0, jpeg);
    }

    #[test]
    fn images_are_embedded_scaled_and_missing_ones_reported() {
        let dir = project();
        write_image(
            &dir.path().join("assets/小图.png"),
            100,
            50,
            ImageFormat::Png,
        );
        write_image(
            &dir.path().join("assets/照片.jpg"),
            3000,
            1500,
            ImageFormat::Jpeg,
        );
        write_image(
            &dir.path().join("assets/竖图.png"),
            400,
            1600,
            ImageFormat::Png,
        );
        fs::write(dir.path().join("assets/坏.png"), b"not an image").unwrap();
        let (bytes, report) = export_ok(
            &dir,
            &[(
                "a",
                vec![1],
                "图",
                "![小图](../assets/小图.png)\n\n![照片](../assets/照片.jpg)\n\n![竖图](../assets/竖图.png)\n\n![坏](../assets/坏.png)\n\n![丢](../assets/丢.png)",
            )],
        );
        assert_eq!(media_count(&bytes), 3);
        let mut archive = zip::ZipArchive::new(Cursor::new(&bytes)).unwrap();
        let jpegs: Vec<_> = archive
            .file_names()
            .filter(|name| name.ends_with(".jpeg"))
            .map(str::to_owned)
            .collect();
        assert_eq!(jpegs.len(), 1);
        let mut encoded = Vec::new();
        archive.by_name(&jpegs[0]).unwrap()
            .read_to_end(&mut encoded).unwrap();
        let scaled = image::load_from_memory(&encoded).unwrap();
        assert_eq!((scaled.width(), scaled.height()), (2400, 1200));
        assert_eq!(
            report.missing_images,
            vec!["../assets/坏.png", "../assets/丢.png"]
        );
        let xml = part(&bytes, "word/document.xml");
        assert!(xml.contains("[图片无法显示：丢]"));
        assert!(xml.contains(r#"<w:pStyle w:val="Caption" />"#));
        // 小图不放大：100×50 像素 = 952500×476250 EMU。
        assert!(xml.contains(r#"cx="952500" cy="476250""#));
        // 宽图缩放到正文宽度（9026 twip × 635 = 5731510 EMU）。
        assert!(xml.contains(r#"cx="5731510" cy="2865755""#));
        // 竖长图按完整正文区高度（697.9 磅）扣除前后间距、余量与一行图注后缩小，比例不变。
        let (cx, cy) = extents(&xml)[2];
        let limit = 697.9 - 12.0 * 2.0 - 4.0 - 21.0;
        assert!((cy / EMU_PER_PT - limit).abs() < 0.1, "{cy}");
        assert!((cx / cy - 0.25).abs() < 1e-3);
    }

    /// document.xml 中各图片的显示尺寸（EMU），按出现顺序。
    fn extents(xml: &str) -> Vec<(f64, f64)> {
        xml.split("<wp:extent ")
            .skip(1)
            .map(|rest| {
                let value = |name: &str| -> f64 {
                    let start = rest.find(&format!(r#"{name}=""#)).unwrap() + name.len() + 2;
                    rest[start..start + rest[start..].find('"').unwrap()]
                        .parse()
                        .unwrap()
                };
                (value("cx"), value("cy"))
            })
            .collect()
    }

    /// styles.xml 中某个样式定义的 XML 片段。
    fn style_xml<'a>(styles: &'a str, id: &str) -> &'a str {
        let start = styles
            .find(&format!(r#"w:styleId="{id}""#))
            .unwrap_or_else(|| panic!("style {id} missing"));
        let end = styles[start..].find("</w:style>").unwrap() + start;
        &styles[start..end]
    }

    #[test]
    fn default_output_styles_use_builtin_word_styles() {
        let dir = project();
        write_image(&dir.path().join("assets/图.png"), 100, 50, ImageFormat::Png);
        let (bytes, _) = export_ok(
            &dir,
            &[(
                "a",
                vec![1],
                "绪论",
                "正文\n\n> 引用\n\n| a |\n| - |\n| 1 |\n\n![图注](../assets/图.png)",
            )],
        );
        let styles = part(&bytes, "word/styles.xml");

        // 正文（Normal / 文档默认）：宋体类字体、12 磅（半磅 24）、行距至少 21 磅（420 twip）、段间不额外留空。
        let defaults = &styles
            [styles.find("<w:docDefaults>").unwrap()..styles.find("</w:docDefaults>").unwrap()];
        assert!(defaults.contains(r#"w:ascii="Times New Roman""#), "{defaults}");
        assert!(defaults.contains(r#"w:eastAsia="SimSun""#));
        assert!(defaults.contains(r#"<w:sz w:val="24" />"#));
        assert!(
            defaults.contains(r#"w:line="420""#) && defaults.contains(r#"w:lineRule="atLeast""#)
        );
        assert!(defaults.contains(r#"w:after="0""#), "{defaults}");

        // 正文段落：Body Text，两端对齐，首行缩进 2 字符（24 磅）。
        let body_text = style_xml(&styles, "BodyText");
        assert!(body_text.contains(r#"w:val="Body Text""#), "{body_text}");
        assert!(body_text.contains(r#"<w:jc w:val="both" />"#));
        assert!(body_text.contains(r#"w:firstLine="480""#));

        // 标题：内置 Heading 1..9（名称 heading N），带大纲级别；一级标题另起一页；
        // 第 4 级之后沿用第 4 级的字号与间距。
        let h1 = style_xml(&styles, "Heading1");
        assert!(h1.contains(r#"w:val="heading 1""#), "{h1}");
        assert!(h1.contains(r#"w:eastAsia="SimHei""#));
        assert!(h1.contains(r#"<w:sz w:val="36" />"#));
        assert!(h1.contains(r#"<w:outlineLvl w:val="0" />"#));
        assert!(h1.contains("<w:pageBreakBefore />"), "{h1}");
        assert!(!style_xml(&styles, "Heading2").contains("<w:pageBreakBefore"));
        let h4 = style_xml(&styles, "Heading4");
        let h7 = style_xml(&styles, "Heading7");
        assert_eq!(
            h4.replace("Heading4", "X")
                .replace("heading 4", "x")
                .replace("w:val=\"3\"", "L"),
            h7.replace("Heading7", "X")
                .replace("heading 7", "x")
                .replace("w:val=\"6\"", "L")
        );
        // 引用：楷体，西文沿用衬线；左侧 2 磅浅灰竖线。
        let quote = style_xml(&styles, "Quote");
        assert!(quote.contains(r#"w:eastAsia="KaiTi""#), "{quote}");
        assert!(quote.contains(r#"w:ascii="Times New Roman""#));
        assert!(
            quote.contains(r#"<w:pBdr><w:left w:val="single" w:space="8" w:sz="16" w:color="C8C8C8" /></w:pBdr>"#),
            "{quote}"
        );
        // 图注：内置 Caption（名称 caption），居中。
        let caption = style_xml(&styles, "Caption");
        assert!(caption.contains(r#"w:val="caption""#), "{caption}");
        assert!(caption.contains(r#"<w:sz w:val="20" />"#));
        assert!(style_xml(&styles, "TableText").contains(r#"<w:sz w:val="21" />"#));

        let xml = part(&bytes, "word/document.xml");
        assert!(xml.contains(r#"<w:pStyle w:val="BodyText" />"#));
        assert!(xml.contains(r#"<w:pStyle w:val="TableText" />"#));
        assert!(xml.contains(r#"<w:pStyle w:val="Caption" />"#));
        // 正文段落不写逐段的字体与字号：由 Normal 决定，接收者可以统一修改。
        let body = &xml[xml.find("正文").unwrap().saturating_sub(300)..xml.find("正文").unwrap()];
        assert!(!body.contains("<w:rFonts") && !body.contains("<w:sz "), "{body}");
    }

    #[test]
    fn figures_are_centered_and_kept_with_their_caption() {
        let dir = project();
        write_image(&dir.path().join("assets/图.png"), 100, 50, ImageFormat::Png);
        let (bytes, _) = export_ok(&dir, &[("a", vec![1], "图", "![图注](../assets/图.png)")]);
        let xml = part(&bytes, "word/document.xml");
        let figure = &xml[..xml.find(r#"cx="952500""#).unwrap()];
        let figure = &figure[figure.rfind("<w:pPr>").unwrap()..];
        assert!(figure.contains(r#"<w:jc w:val="center" />"#), "{figure}");
        assert!(figure.contains("<w:keepNext />"), "{figure}");
    }

    #[test]
    fn tall_image_in_a_table_cell_leaves_room_for_the_repeating_header() {
        let dir = project();
        write_image(&dir.path().join("assets/长.png"), 200, 4000, ImageFormat::Png);
        let (bytes, _) = export_ok(
            &dir,
            &[(
                "a",
                vec![1],
                "表",
                "| 图 | 说明 |\n| --- | --- |\n| ![长](../assets/长.png) | 很长的图 |",
            )],
        );
        let (cx, cy) = extents(&part(&bytes, "word/document.xml"))[0];
        // 正文区 697.9 磅，减去表头（一行 10.5 磅表格文字按 1.5 倍行距上限 + 段落间距 4）、
        // 本行段落间距 4 与余量 4。
        let limit = 697.9 - (15.75 + 4.0) - 4.0 - 4.0;
        assert!((cy / EMU_PER_PT - limit).abs() < 0.1, "{}", cy / EMU_PER_PT);
        assert!((cy / cx - 20.0).abs() < 0.01);
    }

    #[test]
    fn long_wrapped_caption_reserves_every_line() {
        let dir = project();
        write_image(&dir.path().join("assets/竖图.png"), 400, 1600, ImageFormat::Png);
        let caption = vec!["W".repeat(30); 4].join(" ");
        let (bytes, _) = export_ok(
            &dir,
            &[("a", vec![1], "图", &format!("![{caption}](../assets/竖图.png)"))],
        );
        let (_, cy) = extents(&part(&bytes, "word/document.xml"))[0];
        // 四个 30 字符的单词按折行上限各占一行：4 × 21 磅（正文最小行距）。
        let limit = 697.9 - 12.0 * 2.0 - 4.0 - 4.0 * 21.0;
        assert!((cy / EMU_PER_PT - limit).abs() < 0.1, "{}", cy / EMU_PER_PT);
    }

    #[test]
    fn images_in_table_cells_fit_the_cell_width() {
        let dir = project();
        write_image(&dir.path().join("assets/宽.png"), 1200, 600, ImageFormat::Png);
        let (bytes, _) = export_ok(
            &dir,
            &[(
                "a",
                vec![1],
                "表",
                "| 甲 | 乙 | 丙 |\n| --- | --- | --- |\n| ![宽](../assets/宽.png) | 2 | 3 |",
            )],
        );
        let xml = part(&bytes, "word/document.xml");
        // 三列等宽：9026 / 3 = 3008 twip，减去左右内边距 2 × 108 → 2792 twip = 139.6 磅；保持比例。
        let (cx, cy) = extents(&xml)[0];
        assert!((cx / EMU_PER_PT - 139.6).abs() < 0.01, "{cx}");
        assert!((cx / cy - 2.0).abs() < 1e-3);
    }

    #[test]
    fn control_characters_and_unsafe_links_do_not_break_the_file() {
        let dir = project();
        let (bytes, _) = export_ok(
            &dir,
            &[(
                "a",
                vec![1],
                "标题\u{1}\u{8}",
                "正文\u{0}\u{b}\u{1b}内容 [x](javascript:alert(1)) [y](https://a.com/\"x)",
            )],
        );
        let xml = part(&bytes, "word/document.xml");
        assert!(xml.contains("正文内容"));
        assert!(!xml.contains('\u{1b}'));
        assert!(!part(&bytes, "word/_rels/document.xml.rels").contains("javascript"));
    }

    #[test]
    fn empty_and_deep_documents() {
        let dir = project();
        let (bytes, _) = export_ok(&dir, &[]);
        assert!(part(&bytes, "word/document.xml").contains("示例论文"));

        let deep: Vec<(&str, Vec<u32>, &str, &str)> =
            vec![("d", vec![1; 32], "第 32 层", "# 正文标题")];
        let (bytes, _) = export_ok(&dir, &deep);
        let xml = part(&bytes, "word/document.xml");
        assert!(xml.contains(r#"<w:pStyle w:val="Heading9" />"#));
        assert!(!xml.contains("Heading10"));
    }

    #[test]
    fn deeply_nested_lists_stay_within_defined_levels() {
        let dir = project();
        let markdown: String = (0..20)
            .map(|i| format!("{}- 第 {i} 层\n", "  ".repeat(i)))
            .collect();
        let (bytes, _) = export_ok(&dir, &[("a", vec![1], "列表", &markdown)]);
        let xml = part(&bytes, "word/document.xml");
        assert!(xml.contains(r#"<w:ilvl w:val="8" />"#));
        assert!(!xml.contains(r#"<w:ilvl w:val="9" />"#));
        assert!(xml.contains("第 19 层"));
    }

    #[test]
    fn document_info_forms_a_cover_page_without_header_or_page_number() {
        let dir = project();
        let (bytes, _) = export_ok(&dir, &[("a", vec![1], "绪论", "正文")]);
        let xml = part(&bytes, "word/document.xml");
        let sect = &xml[xml.find("<w:sectPr>").unwrap()..];
        // 封面使用单独的首页页眉页脚（空），并记为第 0 页，正文从第 1 页开始。
        assert!(sect.contains("<w:titlePg />"), "{sect}");
        assert!(sect.contains(r#"<w:pgNumType w:start="0" />"#), "{sect}");
        assert!(sect.contains(r#"<w:headerReference w:type="first""#));
        assert!(sect.contains(r#"<w:footerReference w:type="first""#));
        // 页眉：文档标题，使用内置 header 样式；页脚页码使用 footer 样式。
        let header = part(&bytes, "word/header1.xml");
        assert!(header.contains(r#"<w:pStyle w:val="Header" />"#), "{header}");
        assert!(header.contains("示例论文"));
        assert!(part(&bytes, "word/footer1.xml").contains(r#"<w:pStyle w:val="Footer" />"#));
        assert!(style_xml(&part(&bytes, "word/styles.xml"), "Header").contains(r#"<w:sz w:val="18" />"#));
    }

    /// 没有文档信息时没有封面。文档第一段的"段前分页"不会产生空白页，第一章仍在第一页。
    #[test]
    fn without_document_info_there_is_no_cover() {
        let dir = project();
        let mut request = request(&[("a", vec![1], "绪论", "正文"), ("b", vec![2], "方法", "")]);
        request.title = String::new();
        let (bytes, _) = export(&build(&request), dir.path()).unwrap();
        let xml = part(&bytes, "word/document.xml");
        assert!(!xml.contains("<w:titlePg />"));
        assert!(!xml.contains("<w:pgNumType"));
        assert!(!xml.contains("headerReference"));
        assert!(xml.find("1 绪论").unwrap() < xml.find("2 方法").unwrap());
    }

    #[test]
    fn tables_are_three_line_and_rules_are_short() {
        let dir = project();
        let (bytes, _) = export_ok(
            &dir,
            &[("a", vec![1], "表", "| 甲 | 乙 |\n| --- | --- |\n| 1 | 2 |\n\n---")],
        );
        let xml = part(&bytes, "word/document.xml");
        // 顶线、底线 1 磅，表头下 0.5 磅，没有竖线与其他横线。
        assert!(xml.contains(
            r#"<w:tblBorders><w:top w:val="single" w:sz="8" w:space="0" w:color="000000" /><w:bottom w:val="single" w:sz="8" w:space="0" w:color="000000" /></w:tblBorders>"#
        ));
        assert_eq!(
            xml.matches(r#"<w:tcBorders><w:bottom w:val="single" w:sz="4""#).count(),
            2
        );
        assert_eq!(xml.matches("<w:tcBorders>").count(), 2);
        // 分隔线：居中，约为正文宽度的 30%，只有下边线。
        assert!(xml.contains(r#"<w:ind w:left="3159" w:right="3159" />"#), "{xml}");
        assert!(xml.contains(
            r#"<w:pBdr><w:bottom w:val="single" w:space="0" w:sz="4" w:color="A0A0A0" /></w:pBdr>"#
        ));
    }

    #[test]
    fn many_chapters() {
        let dir = project();
        let owned: Vec<(String, Vec<u32>, String, String)> = (1..=500)
            .map(|i| {
                (
                    format!("c{i}"),
                    vec![i],
                    format!("第 {i} 章"),
                    format!("第 {i} 章正文。\n\n- 要点"),
                )
            })
            .collect();
        let chapters: Vec<(&str, Vec<u32>, &str, &str)> = owned
            .iter()
            .map(|(a, b, c, d)| (a.as_str(), b.clone(), c.as_str(), d.as_str()))
            .collect();
        let (bytes, _) = export_ok(&dir, &chapters);
        assert!(part(&bytes, "word/document.xml").contains("500 第 500 章"));
    }

    #[test]
    fn xml_safe_keeps_whitespace_and_unicode() {
        assert_eq!(
            xml_safe("a\tb\nc\r中文🎉\u{0}\u{1f}\u{FFFF}"),
            "a\tb\nc\r中文🎉"
        );
    }
}

/// 手动检查用：`WRITER_SAMPLE_DIR=<目录> cargo test write_sample_docx -- --ignored`
/// 在指定目录生成一份覆盖各种内容的 sample.docx，用 Word / WPS / textutil 打开核对。
#[cfg(test)]
#[test]
#[ignore]
fn write_sample_docx() {
    use crate::export::images::tests::write_image;
    use crate::render::{build, RenderChapter, RenderRequest};
    let out =
        std::path::PathBuf::from(std::env::var("WRITER_SAMPLE_DIR").expect("WRITER_SAMPLE_DIR"));
    let root = out.join("sample-project");
    std::fs::create_dir_all(root.join("assets")).unwrap();
    std::fs::create_dir_all(root.join("content")).unwrap();
    write_image(
        &root.join("assets/示意图.jpg"),
        640,
        320,
        image::ImageFormat::Jpeg,
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
        subtitle: "长文档写作与输出".into(),
        author: "示例作者".into(),
        chapters: vec![
            chapter("a", vec![1], "绪论", "长文档写作需要**清晰的结构**与*稳定的输出*。中文段落\n折行不会产生多余空格。\n\n- 章节组织\n- 自动编号\n  1. 子项一\n  2. 子项二"),
            chapter("b", vec![1, 1], "研究背景", "> 引用：方法决定结果。\n\n| 组别 | 样本数 |\n| --- | --: |\n| 对照组 | 30 |\n| 实验组 | 32 |"),
            chapter("c", vec![2], "方法", "![示意图](../assets/示意图.jpg)\n\n![曲线（竖长图）](../assets/曲线.png)\n\n```\nfn main() {\n    println!(\"你好\");\n}\n```\n\n## 正文小标题\n\n访问 [官网](https://example.com)。\n\n1. 第一步\n2. 第二步"),
        ],
        references: Vec::new(),
    };
    let (bytes, report) = export(&build(&request), &root).unwrap();
    assert!(report.missing_images.is_empty());
    std::fs::write(out.join("sample.docx"), bytes).unwrap();
}
