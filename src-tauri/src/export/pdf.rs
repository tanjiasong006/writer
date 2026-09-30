//! PDF 导出：把 `render::Document` 生成 Typst 源码，用内嵌的 Typst 排版为 PDF。
//!
//! - 用户文本一律以 Typst 字符串字面量（`#"..."`）注入，不存在"正文里的符号被当作 Typst 语法"的问题。
//! - 排版使用 PDF 的默认输出参数（`export::theme`）：在 preamble 中翻译成 Typst 的 set / show 规则。
//! - 图片按统一规则自动排版（`export::images`）：保持比例、不放大，不超过所在容器的宽度与完整正文区高度；
//!   独立成段的图片居中，有图注时为图注预留空间。尺寸与图片落在页上的位置无关：当前页放不下时，
//!   图片与图注作为一个整体移到下一页，不为塞进页底而缩小。
//! - 字体来自 `fonts.rs` 的字体族 fallback 链；只保留本机实际存在的字体族，Typst 还会对缺字逐字形回退。
//! - 文档含中文而本机没有任何能显示中文的字体时报 `NoCjkFont`，不静默输出缺字。
//! - Typst 的文件 id 全局驻留且数量有上限，因此虚拟路径固定（/main.typ、/img/<序号>.png），
//!   每次导出后清理 comemo 缓存，长时间运行的应用不会累积内存。

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
use super::images::{caption_height_pt, display_size_pt, load_for_docx, Bounds};
use super::theme::{HeadingStyle, Theme};
use super::{ExportError, ExportReport};
use crate::render::markdown::{plain_text, Align, Block, Inline};
use crate::render::{resolve_image, Document, Section};

/// A4 正文区（210mm × 297mm 减去四边 25mm 页边距 = 160mm × 247mm）对应的磅数。
const TEXT_WIDTH_PT: f64 = 453.5;
const TEXT_HEIGHT_PT: f64 = 700.1;
/// 图片高度上限再留出的余量（磅），吸收取整差异，保证图片与图注不会被挤出正文区。
const IMAGE_HEIGHT_SLACK: f64 = 2.0;
/// Typst figure 中图片与图注之间的默认间距（em，相对正文字号）。
const FIGURE_GAP_EM: f64 = 0.65;
/// 表格单元格的内边距（磅），与 preamble 中的 `table(inset: …)` 一致。
const TABLE_INSET_PT: f64 = 6.0;
/// 标题的行高（字号的倍数）。
const HEADING_LINE_HEIGHT: f64 = 1.4;

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
) -> Result<(PagedDocument, ExportReport), ExportError> {
    let book = fonts.book();
    if document_has_cjk(document) && !book_has_cjk(book) {
        return Err(ExportError::NoCjkFont);
    }

    let mut writer = Writer {
        theme: Theme::default(),
        root: project_root,
        out: String::new(),
        images: Vec::new(),
        report: ExportReport::default(),
        quote_font: String::new(),
    };
    writer.preamble(document, book);
    for section in &document.sections {
        writer.section(section);
    }

    let world = PdfWorld::new(writer.out, writer.images, fonts);
    let compiled = typst::compile::<PagedDocument>(&world)
        .output
        .map_err(|errors| render_failed(&errors));
    Ok((compiled?, writer.report))
}

pub fn export(
    document: &Document,
    project_root: &Path,
    fonts: &'static FontStore,
) -> Result<(Vec<u8>, ExportReport), ExportError> {
    let result = layout(document, project_root, fonts).and_then(|(paged, report)| {
        typst_pdf::pdf(&paged, &typst_pdf::PdfOptions::default())
            .map(|pdf| (pdf, report))
            .map_err(|errors| render_failed(&errors))
    });
    // 一次性导出不需要保留增量编译缓存。
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
            Block::Heading { inlines, .. } | Block::Paragraph(inlines) => inlines_have_cjk(inlines),
            Block::List { items, .. } => items.iter().any(|item| blocks_have_cjk(item)),
            Block::Quote(blocks) => blocks_have_cjk(blocks),
            Block::Code { text, .. } => text.chars().any(is_cjk),
            Block::Table { header, rows, .. } => {
                header.iter().any(|c| inlines_have_cjk(c))
                    || rows.iter().flatten().any(|c| inlines_have_cjk(c))
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

struct Writer<'a> {
    theme: Theme,
    root: &'a Path,
    out: String,
    images: Vec<Bytes>,
    report: ExportReport,
    /// 引用使用的字体列表（preamble 中按输出参数确定）。
    quote_font: String,
}

impl Writer<'_> {
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
        let theme = self.theme;
        let body = &theme.body;
        let mono = font_list(FontFamily::Mono);
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
        self.out.push_str(&format!(
            "#set document(title: {title})\n\
             #set page(paper: \"a4\", margin: 25mm, numbering: \"1\", number-align: center)\n\
             #set text(font: {body_font}, size: {body_size}pt, lang: \"zh\", region: \"cn\", top-edge: 0.8em, bottom-edge: -0.2em)\n\
             #set par(justify: true, leading: {leading}em, spacing: {spacing}em)\n\
             #set heading(numbering: none)\n",
            body_font = font_list(body.font.into()),
            body_size = num(body.size),
            // 每行的排版框固定为 1em（基线上 0.8em、下 0.2em）：相邻基线距离 = 1em + leading = 行距倍数，
            // 与字体自身的度量无关。
            leading = num(body.line_height - 1.0),
            // 段距在行距之外再加 paragraph_spacing。
            spacing = num(body.line_height - 1.0 + body.paragraph_spacing),
        ));
        // 第 3 级及更深的标题使用 heading3；第 1、2 级的规则在后，优先生效。
        self.out
            .push_str(&heading_rules("heading", &theme.heading3));
        self.out
            .push_str(&heading_rules("heading.where(level: 1)", &theme.heading1));
        self.out
            .push_str(&heading_rules("heading.where(level: 2)", &theme.heading2));
        self.out.push_str(&format!(
            "#show raw: set text(font: {mono}, size: {inline_code}pt)\n\
             #show raw.where(block: true): set text(size: {code}pt)\n\
             #show raw.where(block: true): block.with(fill: luma(243), inset: 8pt, radius: 3pt, width: 100%)\n\
             #set table(stroke: 0.5pt + luma(160), inset: {inset}pt)\n\
             #show table: set text(size: {table}pt)\n\
             #show table.cell.where(y: 0): set text(weight: \"bold\")\n\
             #set figure(numbering: none)\n\
             #show figure: set block(above: {figure}em, below: {figure}em)\n\
             #show figure.caption: set text(font: {caption_font}, size: {caption}pt, fill: luma(100))\n\
             #show link: set text(fill: rgb(\"#2563eb\"))\n",
            inline_code = num(body.size * 0.9),
            inset = num(TABLE_INSET_PT),
            code = num(theme.code_block),
            table = num(theme.table),
            figure = num(theme.image_spacing),
            caption_font = font_list(theme.caption.font.into()),
            caption = num(theme.caption.size),
        ));
        if !document.title.trim().is_empty() {
            self.out.push_str(&format!(
                "#align(center, text(font: {font}, size: {size}pt, weight: \"bold\")[#{title}])\n\n",
                font = font_list(theme.title.font.into()),
                size = num(theme.title.size),
            ));
        }
        self.quote_font = font_list(theme.blockquote.font.into());
    }

    fn section(&mut self, section: &Section) {
        let text = if section.number.is_empty() {
            section.title.clone()
        } else {
            format!("{} {}", section.number, section.title)
        };
        self.out.push_str(&format!(
            "#heading(level: {})[#{}]\n\n",
            section.depth.max(1),
            string(&text)
        ));
        for block in &section.blocks {
            let rendered = self.block(block, section);
            self.out.push_str(&rendered);
            self.out.push_str("\n\n");
        }
    }

    fn block(&mut self, block: &Block, section: &Section) -> String {
        if let Some((src, alt)) = block.as_figure() {
            // 尺寸上限是完整正文区扣除图注及其间距，与图片落在页上的位置无关；
            // figure 不跨页拆分，当前页放不下时连同图注整体移到下一页。
            let theme = &self.theme;
            let mut height = TEXT_HEIGHT_PT - IMAGE_HEIGHT_SLACK;
            if !alt.is_empty() {
                let pitch = theme.caption.size * theme.body.line_height;
                height -= FIGURE_GAP_EM * theme.body.size
                    + caption_height_pt(alt, theme.caption.size, pitch, TEXT_WIDTH_PT);
            }
            let bounds = Bounds {
                width: TEXT_WIDTH_PT,
                height,
            };
            let image = self.image(src, alt, bounds);
            return if alt.is_empty() {
                format!("#figure({image})")
            } else {
                format!("#figure({image}, caption: [#{}])", string(alt))
            };
        }
        match block {
            Block::Heading { level, inlines } => format!(
                "#heading(level: {})[{}]",
                section.body_heading_depth(*level),
                self.inlines(inlines, TEXT_WIDTH_PT)
            ),
            Block::Paragraph(inlines) => self.inlines(inlines, TEXT_WIDTH_PT),
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
                    "#block(inset: (left: 10pt, y: 2pt), stroke: (left: 2pt + luma(200)))[#set text(font: {}, size: {}pt, fill: luma(80))\n{content}]",
                    self.quote_font,
                    num(self.theme.blockquote.size),
                )
            }
            Block::Code { language, text } => match language.as_deref().filter(|l| is_identifier(l)) {
                Some(language) => format!("#raw(block: true, lang: {}, {})", string(language), string(&breakable(text))),
                None => format!("#raw(block: true, {})", string(&breakable(text))),
            },
            Block::Table { alignments, header, rows } => {
                let columns = header.len().max(rows.iter().map(Vec::len).max().unwrap_or(0)).max(1);
                let align: Vec<&str> = (0..columns)
                    .map(|i| match alignments.get(i) {
                        Some(Align::Center) => "center",
                        Some(Align::Right) => "right",
                        _ => "left",
                    })
                    .collect();
                let mut cells = Vec::new();
                // 列宽由内容决定；单元格中的图片不超过按列数等分正文宽度、去掉左右内边距后的宽度，
                // 避免一张图片把整列撑到正文宽度（与 Word 的等宽列一致）。
                let cell_width = TEXT_WIDTH_PT / columns as f64 - 2.0 * TABLE_INSET_PT;
                let row = |writer: &mut Self, row: &[Vec<Inline>]| -> Vec<String> {
                    (0..columns)
                        .map(|i| format!("[{}]", writer.inlines(row.get(i).map_or(&[][..], Vec::as_slice), cell_width)))
                        .collect()
                };
                let head = row(self, header).join(", ");
                for r in rows {
                    cells.extend(row(self, r));
                }
                format!(
                    "#table(columns: {columns}, align: ({},), table.header({head}), {})",
                    align.join(", "),
                    cells.join(", ")
                )
            }
            Block::Rule => "#line(length: 100%, stroke: 0.5pt + luma(180))".to_owned(),
        }
    }

    fn blocks(&mut self, blocks: &[Block], section: &Section) -> String {
        blocks
            .iter()
            .map(|b| self.block(b, section))
            .collect::<Vec<_>>()
            .join("\n\n")
    }

    /// 行内内容；width 是按正文区计算的容器宽度上限（磅），限制其中的图片。
    fn inlines(&mut self, inlines: &[Inline], width: f64) -> String {
        let mut out = String::new();
        for inline in inlines {
            match inline {
                Inline::Text(text) => {
                    out.push('#');
                    out.push_str(&string(&breakable(text)));
                }
                Inline::Strong(children) => {
                    out.push_str(&format!("#strong[{}]", self.inlines(children, width)))
                }
                Inline::Emphasis(children) => {
                    out.push_str(&format!("#emph[{}]", self.inlines(children, width)))
                }
                Inline::Strike(children) => {
                    out.push_str(&format!("#strike[{}]", self.inlines(children, width)))
                }
                Inline::Code(code) => out.push_str(&format!("#raw({})", string(&breakable(code)))),
                Inline::Link { url, children } => {
                    let content = self.inlines(children, width);
                    if is_safe_url(url) {
                        out.push_str(&format!("#link({})[{content}]", string(url)));
                    } else {
                        out.push_str(&content);
                    }
                }
                Inline::Image { src, alt } => {
                    // 与文字同段的图片（含表格单元格中的）：不超过所在容器的宽度，高度不超过正文区。
                    let bounds = Bounds {
                        width,
                        height: TEXT_HEIGHT_PT - IMAGE_HEIGHT_SLACK,
                    };
                    let image = self.image(src, alt, bounds);
                    out.push_str(&format!("#box({image})"));
                }
                Inline::SoftBreak => out.push_str("#\" \""),
                Inline::HardBreak => out.push_str("#linebreak()"),
            }
        }
        out
    }

    /// 图片表达式；无法加载时返回红色占位文字并记入报告。
    /// bounds 是按正文区计算的上限；实际宽度在排版时再受所在容器（列表、引用、表格单元格）的宽度限制，
    /// 只给出宽度，高度按比例得到。
    fn image(&mut self, src: &str, alt: &str, bounds: Bounds) -> String {
        let Some(image) = resolve_image(self.root, src).and_then(|path| load_for_docx(&path))
        else {
            self.report.missing_images.push(src.to_owned());
            let label = if alt.is_empty() { src } else { alt };
            return format!(
                "text(fill: rgb(\"#b91c1c\"))[#{}]",
                string(&format!("[图片无法显示：{label}]"))
            );
        };
        let index = self.images.len();
        self.images.push(Bytes::new(image.png));
        let (width, _) = display_size_pt(image.width, image.height, bounds);
        format!(
            "layout(size => image(\"/img/{index}.png\", width: calc.min({width:.2}pt, size.width)))"
        )
    }
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

struct PdfWorld {
    library: LazyHash<Library>,
    fonts: &'static FontStore,
    main: Source,
    images: Vec<(FileId, Bytes)>,
}

fn file_id(path: &str) -> FileId {
    let vpath = VirtualPath::new(path).expect("static virtual paths are valid");
    RootedPath::new(VirtualRoot::Project, vpath).intern()
}

impl PdfWorld {
    fn new(source: String, images: Vec<Bytes>, fonts: &'static FontStore) -> Self {
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
            Ok(self.main.clone())
        } else {
            Err(FileError::NotSource)
        }
    }

    fn file(&self, id: FileId) -> FileResult<Bytes> {
        if id == self.main.id() {
            return Ok(Bytes::from_string(self.main.clone()));
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

    #[test]
    fn full_document_compiles_to_pdf() {
        let dir = project();
        write_image(
            &dir.path().join("assets/图.png"),
            800,
            400,
            ImageFormat::Png,
        );
        let markdown = "**粗体**、*斜体*、~~删除~~、`code`、[链接](https://example.com)\n\n\
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
        let (pdf, report) = export(&document, dir.path(), system_fonts()).unwrap();
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
        let (paged, _) = layout(&document, dir.path(), system_fonts()).unwrap();
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
    #[derive(Debug)]
    enum Placed {
        Text {
            page: usize,
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
        let (paged, _) = layout(&build(&request), dir.path(), system_fonts()).unwrap();
        let items = placed(&paged);

        let heading: Vec<_> = items
            .iter()
            .filter_map(|p| match p {
                Placed::Text {
                    size, family, text, ..
                } if text.contains("标题甲") => Some((*size, family.clone())),
                _ => None,
            })
            .collect();
        assert!(!heading.is_empty());
        for (size, family) in &heading {
            assert_eq!(*size, 16.0);
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
            // 相邻基线距离 = 字号 × 行距倍数（12 × 1.8）。
            assert!(
                (pair[1] - pair[0] - 21.6).abs() < 0.05,
                "line pitch {}",
                pair[1] - pair[0]
            );
        }
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
        let (paged, _) = layout(&document, dir.path(), system_fonts()).unwrap();
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
        let (paged, _) = layout(&document, dir.path(), system_fonts()).unwrap();
        let page_height = paged.pages()[0].frame.height().to_pt();
        let images = images(&paged);
        assert_eq!(images.len(), 1);
        let (page, _, y, width, height) = images[0];
        // 标题与正文之后放不下：整体移到第二页，而不是缩小后塞进第一页的剩余空间。
        assert_eq!(page, 1);
        // 高度按完整正文区扣除一行图注与间距计算，比例不变。
        let expected = TEXT_HEIGHT_PT - IMAGE_HEIGHT_SLACK - FIGURE_GAP_EM * 12.0 - 10.0 * 1.8;
        assert!((height - expected).abs() < 0.5, "{height} vs {expected}");
        assert!((width / height - 0.25).abs() < 1e-3);
        // 图片与图注在同一页，且都在正文区内，不占用页脚。
        assert!(y >= MARGIN_PT - 0.5 && y + height <= page_height - MARGIN_PT + 0.5);
        let caption = placed(&paged).into_iter().find_map(|p| match p {
            Placed::Text { page, y, text, .. } if text.contains("图注") => Some((page, y)),
            _ => None,
        });
        let (caption_page, caption_y) = caption.expect("caption");
        assert_eq!(caption_page, 1);
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
        let (paged, _) = layout(&document, dir.path(), system_fonts()).unwrap();
        let (_, x, _, width, height) = images(&paged)[0];
        // 引用有左侧缩进：图片缩小到引用内的可用宽度，不越出正文区右边界。
        assert!(x > MARGIN_PT + 5.0, "{x}");
        assert!(x + width <= MARGIN_PT + TEXT_WIDTH_PT + 0.5, "{x} + {width}");
        assert!((width / height - 4.0).abs() < 0.01);
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
        let (paged, _) = layout(&document, dir.path(), system_fonts()).unwrap();
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
            let result = export(&document, dir.path(), system_fonts());
            assert!(result.is_ok(), "{text:?}: {result:?}");
        }
    }

    #[test]
    fn empty_deep_and_long_documents() {
        let dir = project();
        let (pdf, _) = export(&build(&request("", &[])), dir.path(), system_fonts()).unwrap();
        assert!(pdf.starts_with(b"%PDF-"));

        let deep = build(&request(
            "深",
            &[("d", vec![1; 32], "第 32 层", "# 正文标题")],
        ));
        assert!(export(&deep, dir.path(), system_fonts()).is_ok());

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
            export(&chinese, dir.path(), fonts),
            Err(ExportError::NoCjkFont)
        );
        let english = build(&request("Paper", &[("a", vec![1], "Intro", "Body text.")]));
        assert!(export(&english, dir.path(), fonts).is_ok());
    }

    #[test]
    fn string_literal_escaping() {
        assert_eq!(string("a\"b\\c\nd\u{0}"), "\"a\\\"b\\\\c\\nd\"");
    }
}

/// 手动检查用：`WRITER_SAMPLE_DIR=<目录> cargo test write_sample_pdf -- --ignored`
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
        chapters: vec![
            chapter("a", vec![1], "绪论", "长文档写作需要**清晰的结构**与*稳定的输出*。中文段落\n折行不会产生多余空格。\n\n- 章节组织\n- 自动编号\n  1. 子项一\n  2. 子项二\n\n注入测试：\"]#panic(\"x\")[ $ x $ #strong[不应加粗]"),
            chapter("b", vec![1, 1], "研究背景", "> 引用：方法决定结果。\n\n| 组别 | 样本数 |\n| --- | --: |\n| 对照组 | 30 |\n| 实验组 | 32 |"),
            chapter("c", vec![2], "方法", "![示意图](../assets/示意图.png)\n\n![曲线（竖长图）](../assets/曲线.png)\n\n```\nfn main() {\n    println!(\"你好\");\n}\n```\n\n## 正文小标题\n\n访问 [官网](https://example.com)。\n\n1. 第一步\n2. 第二步"),
        ],
    };
    let (bytes, report) = export(&build(&request), &root, font_store(None)).unwrap();
    assert!(report.missing_images.is_empty());
    std::fs::write(out.join("sample.pdf"), bytes).unwrap();
}
