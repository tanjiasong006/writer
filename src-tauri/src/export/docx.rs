//! Word（.docx）导出，基于 docx-rs。
//!
//! - 章节标题使用内置标题样式（Heading 1..9），Word 导航窗格与目录可直接使用；编号是静态文本，
//!   与预览、PDF 完全一致，不依赖 Word 的自动编号。
//! - 正文内的 `#` 标题叠加在章节层级之下，不带编号。
//! - 所有写入 XML 的文本先去掉 XML 1.0 不允许的控制字符，否则 Word 会拒绝打开整个文件。
//! - 图片缺失或损坏时输出占位文字并记录在报告中，绝不 panic。

use std::io::Cursor;
use std::path::Path;

use docx_rs::{
    AbstractNumbering, AlignmentType, BorderType, BreakType, Docx, Footer, Hyperlink,
    HyperlinkType, IndentLevel, Level, LevelJc, LevelOverride, LevelText, LineSpacing,
    NumberFormat, Numbering, NumberingId, PageMargin, PageNum, Paragraph, ParagraphBorder,
    ParagraphBorderPosition, Pic, Run, RunFonts, Shading, ShdType, SpecialIndentType, Start, Style,
    StyleType, Table, TableCell, TableRow, WidthType,
};

use super::fonts::{docx_fonts, FontRole};
use super::images::load_for_docx;
use super::{ExportError, ExportReport};
use crate::render::markdown::{Align, Block, Inline};
use crate::render::{resolve_image, Document, Section};

/// A4，单位 twip（1/20 磅）。
const PAGE_WIDTH: u32 = 11906;
const PAGE_HEIGHT: u32 = 16838;
const MARGIN: i32 = 1440;
const TEXT_WIDTH: u32 = PAGE_WIDTH - 2 * MARGIN as u32;
/// 1 twip = 635 EMU。
const EMU_PER_TWIP: u32 = 635;
/// 96 DPI 下 1 像素 = 9525 EMU。
const EMU_PER_PX: u64 = 9525;
const LIST_INDENT: i32 = 420;
// docx-rs 默认已定义 abstractNum 1 / num 1，这里的编号定义从 10 开始，避免重复 id。
const BULLET_ABSTRACT: usize = 10;
const DECIMAL_ABSTRACT: usize = 11;
const BULLET_NUMBERING: usize = 10;
const FIRST_LIST_NUMBERING: usize = 11;
const MAX_HEADING: usize = 9;

/// 标题字号（半磅）：H1..H9。
const HEADING_SIZES: [usize; MAX_HEADING] = [32, 28, 26, 24, 24, 24, 24, 24, 24];

pub fn export(
    document: &Document,
    project_root: &Path,
) -> Result<(Vec<u8>, ExportReport), ExportError> {
    let mut writer = Writer {
        root: project_root,
        report: ExportReport::default(),
        next_numbering: FIRST_LIST_NUMBERING,
        numberings: Vec::new(),
        items: Vec::new(),
    };

    if !document.title.trim().is_empty() {
        writer.items.push(Item::Paragraph(
            Paragraph::new()
                .style("Title")
                .add_run(Run::new().add_text(xml_safe(&document.title))),
        ));
    }
    for section in &document.sections {
        writer.section(section);
    }

    let mut docx = base_document();
    for numbering in writer.numberings.drain(..) {
        docx = docx.add_numbering(numbering);
    }
    for item in writer.items.drain(..) {
        docx = match item {
            Item::Paragraph(p) => docx.add_paragraph(p),
            Item::Table(t) => docx.add_table(t),
        };
    }

    let mut bytes = Cursor::new(Vec::new());
    docx.build()
        .pack(&mut bytes)
        .map_err(|error| ExportError::RenderFailed {
            message: error.to_string(),
        })?;
    Ok((bytes.into_inner(), writer.report))
}

// 只在构建期间短暂存在、随后整体移入 Docx，变体大小差异无关紧要。
#[allow(clippy::large_enum_variant)]
enum Item {
    Paragraph(Paragraph),
    Table(Table),
}

struct Writer<'a> {
    root: &'a Path,
    report: ExportReport,
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
    fn section(&mut self, section: &Section) {
        let level = section.depth.clamp(1, MAX_HEADING);
        let text = if section.number.is_empty() {
            section.title.clone()
        } else {
            format!("{} {}", section.number, section.title)
        };
        self.items.push(Item::Paragraph(
            Paragraph::new()
                .style(&format!("Heading{level}"))
                .add_run(Run::new().add_text(xml_safe(&text))),
        ));
        for block in &section.blocks {
            self.block(block, section, BlockContext::default());
        }
    }

    fn block(&mut self, block: &Block, section: &Section, context: BlockContext) {
        if let Some((src, alt)) = block.as_figure() {
            self.figure(src, alt, context);
            return;
        }
        match block {
            Block::Heading { level, inlines } => {
                let level = section.body_heading_depth(*level).clamp(1, MAX_HEADING);
                let p = Paragraph::new().style(&format!("Heading{level}"));
                let p = self.inlines(p, inlines, RunStyle::default());
                self.items.push(Item::Paragraph(p));
            }
            Block::Paragraph(inlines) => {
                let p = self.paragraph_for(context);
                let p = self.inlines(p, inlines, RunStyle::default());
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
                let mut run = Run::new().fonts(fonts(FontRole::Mono)).size(20);
                for (i, line) in text.split('\n').enumerate() {
                    if i > 0 {
                        run = run.add_break(BreakType::TextWrapping);
                    }
                    run = run.add_text(xml_safe(line));
                }
                let p = self
                    .indent(Paragraph::new().style("Code"), context)
                    .add_run(run);
                self.items.push(Item::Paragraph(p));
            }
            Block::Table {
                alignments,
                header,
                rows,
            } => self.table(alignments, header, rows),
            Block::Rule => {
                let mut p = Paragraph::new();
                p.property = p.property.set_border(
                    ParagraphBorder::new(ParagraphBorderPosition::Bottom)
                        .val(BorderType::Single)
                        .size(6)
                        .color("D1D5DB"),
                );
                self.items.push(Item::Paragraph(p));
            }
        }
    }

    /// 普通段落：在引用中使用 Quote 样式，并按列表 / 引用层级缩进。
    fn paragraph_for(&self, context: BlockContext) -> Paragraph {
        let p = if context.quote_level > 0 {
            Paragraph::new().style("Quote")
        } else {
            Paragraph::new()
        };
        self.indent(p, context)
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
        let level = if context.in_list {
            context.list_level
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
                        let mut p = Paragraph::new()
                            .numbering(NumberingId::new(numbering_id), IndentLevel::new(level));
                        if context.quote_level > 0 {
                            p = p.style("Quote");
                        }
                        let p = self.inlines(p, inlines, RunStyle::default());
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
        let bold = RunStyle {
            bold: true,
            ..RunStyle::default()
        };
        let make_row =
            |writer: &mut Self, cells: &[Vec<Inline>], style: RunStyle, is_header: bool| {
                let cells = (0..columns)
                    .map(|i| {
                        let mut p = Paragraph::new();
                        p = match alignments.get(i) {
                            Some(Align::Center) => p.align(AlignmentType::Center),
                            Some(Align::Right) => p.align(AlignmentType::Right),
                            _ => p,
                        };
                        let p =
                            writer.inlines(p, cells.get(i).map_or(&[][..], Vec::as_slice), style);
                        let cell = TableCell::new()
                            .add_paragraph(p)
                            .width(width, WidthType::Dxa);
                        if is_header {
                            cell.shading(Shading::new().shd_type(ShdType::Clear).fill("F3F4F6"))
                        } else {
                            cell
                        }
                    })
                    .collect();
                TableRow::new(cells)
            };
        let mut table_rows = vec![make_row(self, header, bold, true)];
        for row in rows {
            table_rows.push(make_row(self, row, RunStyle::default(), false));
        }
        let table = Table::new(table_rows)
            .set_grid(vec![width; columns])
            .width(TEXT_WIDTH as usize, WidthType::Dxa);
        self.items.push(Item::Table(table));
        // 紧跟的段落与表格之间留出间距。
        self.items.push(Item::Paragraph(Paragraph::new()));
    }

    fn figure(&mut self, src: &str, alt: &str, context: BlockContext) {
        let p = self.indent(Paragraph::new().align(AlignmentType::Center), context);
        let p = p.add_run(self.image_run(src, alt));
        self.items.push(Item::Paragraph(p));
        if !alt.is_empty() {
            self.items.push(Item::Paragraph(
                Paragraph::new()
                    .style("Caption")
                    .add_run(Run::new().add_text(xml_safe(alt))),
            ));
        }
    }

    fn image_run(&mut self, src: &str, alt: &str) -> Run {
        let image = resolve_image(self.root, src).and_then(|path| load_for_docx(&path));
        let Some(image) = image else {
            self.report.missing_images.push(src.to_owned());
            let label = if alt.is_empty() { src } else { alt };
            return Run::new()
                .color("B91C1C")
                .add_text(xml_safe(&format!("[图片无法显示：{label}]")));
        };
        let max_width = u64::from(TEXT_WIDTH * EMU_PER_TWIP);
        let mut width = u64::from(image.width) * EMU_PER_PX;
        let mut height = u64::from(image.height) * EMU_PER_PX;
        if width > max_width {
            height = height * max_width / width;
            width = max_width;
        }
        let pic = Pic::new_with_dimensions(image.png, image.width, image.height).size(
            u32::try_from(width).unwrap_or(u32::MAX),
            u32::try_from(height).unwrap_or(u32::MAX),
        );
        Run::new().add_image(pic)
    }

    fn inlines(&mut self, mut p: Paragraph, inlines: &[Inline], style: RunStyle) -> Paragraph {
        for inline in inlines {
            p = match inline {
                Inline::Text(text) => p.add_run(styled(Run::new().add_text(xml_safe(text)), style)),
                Inline::Strong(children) => self.inlines(
                    p,
                    children,
                    RunStyle {
                        bold: true,
                        ..style
                    },
                ),
                Inline::Emphasis(children) => self.inlines(
                    p,
                    children,
                    RunStyle {
                        italic: true,
                        ..style
                    },
                ),
                Inline::Strike(children) => self.inlines(
                    p,
                    children,
                    RunStyle {
                        strike: true,
                        ..style
                    },
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
                    let run = styled(Run::new().add_text(xml_safe(&text)), style)
                        .color("2563EB")
                        .underline("single");
                    if is_safe_url(url) {
                        p.add_hyperlink(
                            Hyperlink::new(url.as_str(), HyperlinkType::External).add_run(run),
                        )
                    } else {
                        p.add_run(run)
                    }
                }
                Inline::Image { src, alt } => {
                    let run = self.image_run(src, alt);
                    p.add_run(run)
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
            .fonts(fonts(FontRole::Mono))
            .shading(Shading::new().shd_type(ShdType::Clear).fill("F3F4F6"));
    }
    run
}

fn fonts(role: FontRole) -> RunFonts {
    let names = docx_fonts(role);
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

fn base_document() -> Docx {
    let body = fonts(FontRole::Body);
    let heading = fonts(FontRole::Heading);

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
        .default_fonts(body)
        .default_size(24)
        .default_line_spacing(LineSpacing::new().line(360).after(120))
        .footer(
            Footer::new().add_paragraph(
                Paragraph::new()
                    .align(AlignmentType::Center)
                    .add_page_num(PageNum::new()),
            ),
        )
        .add_style(
            Style::new("Title", StyleType::Paragraph)
                .name("Title")
                .based_on("Normal")
                .fonts(heading.clone())
                .size(44)
                .bold()
                .align(AlignmentType::Center)
                .q_format(true),
        )
        .add_style(
            Style::new("Code", StyleType::Paragraph)
                .name("Code")
                .based_on("Normal")
                .fonts(fonts(FontRole::Mono))
                .size(20)
                .line_spacing(LineSpacing::new().line(276).after(120)),
        )
        .add_style(
            Style::new("Quote", StyleType::Paragraph)
                .name("Quote")
                .based_on("Normal")
                .color("4B5563")
                .indent(Some(LIST_INDENT), None, None, None),
        )
        .add_style(
            Style::new("Caption", StyleType::Paragraph)
                .name("caption")
                .based_on("Normal")
                .size(20)
                .color("6B7280")
                .align(AlignmentType::Center),
        );

    for level in 1..=MAX_HEADING {
        docx = docx.add_style(
            Style::new(format!("Heading{level}"), StyleType::Paragraph)
                .name(format!("heading {level}"))
                .based_on("Normal")
                .next("Normal")
                .fonts(heading.clone())
                .size(HEADING_SIZES[level - 1])
                .bold()
                .outline_lvl(level - 1)
                .line_spacing(LineSpacing::new().before(240).after(120))
                .q_format(true),
        );
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
        // 第 1 级章节中的 ## → 第 3 级标题，不带编号。
        assert!(xml.contains(r#"<w:pStyle w:val="Heading3" />"#));
        assert!(xml.contains("正文第一段。"));
        let styles = part(&bytes, "word/styles.xml");
        assert!(styles.contains(r#"w:styleId="Heading1""#));
        assert!(styles.contains(r#"<w:outlineLvl w:val="0" />"#));
        assert!(styles.contains(r#"w:eastAsia="SimHei""#));
        assert!(report.missing_images.is_empty());
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
        fs::write(dir.path().join("assets/坏.png"), b"not an image").unwrap();
        let (bytes, report) = export_ok(
            &dir,
            &[(
                "a",
                vec![1],
                "图",
                "![小图](../assets/小图.png)\n\n![照片](../assets/照片.jpg)\n\n![坏](../assets/坏.png)\n\n![丢](../assets/丢.png)",
            )],
        );
        assert_eq!(media_count(&bytes), 2);
        assert_eq!(
            report.missing_images,
            vec!["../assets/坏.png", "../assets/丢.png"]
        );
        let xml = part(&bytes, "word/document.xml");
        assert!(xml.contains("[图片无法显示：丢]"));
        assert!(xml.contains(r#"<w:pStyle w:val="Caption" />"#));
        // 100×50 像素 = 952500×476250 EMU。
        assert!(xml.contains(r#"cx="952500" cy="476250""#));
        // 宽图缩放到正文宽度（9026 twip × 635 = 5731510 EMU）。
        assert!(xml.contains(r#"cx="5731510" cy="2865755""#));
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
        &root.join("assets/示意图.png"),
        640,
        320,
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
        chapters: vec![
            chapter("a", vec![1], "绪论", "长文档写作需要**清晰的结构**与*稳定的输出*。中文段落\n折行不会产生多余空格。\n\n- 章节组织\n- 自动编号\n  1. 子项一\n  2. 子项二"),
            chapter("b", vec![1, 1], "研究背景", "> 引用：方法决定结果。\n\n| 组别 | 样本数 |\n| --- | --: |\n| 对照组 | 30 |\n| 实验组 | 32 |"),
            chapter("c", vec![2], "方法", "![示意图](../assets/示意图.png)\n\n```\nfn main() {\n    println!(\"你好\");\n}\n```\n\n## 正文小标题\n\n访问 [官网](https://example.com)。\n\n1. 第一步\n2. 第二步"),
        ],
    };
    let (bytes, report) = export(&build(&request), &root).unwrap();
    assert!(report.missing_images.is_empty());
    std::fs::write(out.join("sample.docx"), bytes).unwrap();
}
