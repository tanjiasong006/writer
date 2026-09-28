//! PDF 导出：把 `render::Document` 生成 Typst 源码，用内嵌的 Typst 排版为 PDF。
//!
//! - 用户文本一律以 Typst 字符串字面量（`#"..."`）注入，不存在"正文里的符号被当作 Typst 语法"的问题。
//! - 字体来自 `fonts.rs` 的角色 fallback 链；只保留本机实际存在的字体族，Typst 还会对缺字逐字形回退。
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

use super::fonts::{bundled_font_dirs, families, FontRole, CJK_PROBE};
use super::images::{display_size_pt, load_for_docx};
use super::{ExportError, ExportReport};
use crate::render::markdown::{plain_text, Align, Block, Inline};
use crate::render::{resolve_image, Document, Section};

/// A4 正文宽度（210mm − 2 × 25mm = 160mm）对应的磅数。
const TEXT_WIDTH_PT: f64 = 453.5;

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
        root: project_root,
        out: String::new(),
        images: Vec::new(),
        report: ExportReport::default(),
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

/// 角色的候选字体中本机实际存在的部分；都不存在时返回空（交给 Typst 的回退）。
fn available_families(book: &FontBook, role: FontRole) -> Vec<&'static str> {
    families(role)
        .iter()
        .copied()
        .filter(|family| book.contains_family(&family.to_lowercase()))
        .collect()
}

struct Writer<'a> {
    root: &'a Path,
    out: String,
    images: Vec<Bytes>,
    report: ExportReport,
}

impl Writer<'_> {
    fn preamble(&mut self, document: &Document, book: &FontBook) {
        let font_list = |role| {
            let names = available_families(book, role);
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
        let body = font_list(FontRole::Body);
        let heading = font_list(FontRole::Heading);
        let mono = font_list(FontRole::Mono);
        let title = string(&document.title);
        self.out.push_str(&format!(
            "#set document(title: {title})\n\
             #set page(paper: \"a4\", margin: 25mm, numbering: \"1\", number-align: center)\n\
             #set text(font: {body}, size: 12pt, lang: \"zh\", region: \"cn\")\n\
             #set par(justify: true, leading: 0.9em, spacing: 1.2em)\n\
             #set heading(numbering: none)\n\
             #show heading: set text(font: {heading}, size: 12pt)\n\
             #show heading: set block(above: 1.4em, below: 0.8em)\n\
             #show heading.where(level: 1): set text(size: 16pt)\n\
             #show heading.where(level: 2): set text(size: 14pt)\n\
             #show heading.where(level: 3): set text(size: 13pt)\n\
             #show raw: set text(font: {mono}, size: 10pt)\n\
             #show raw.where(block: true): block.with(fill: luma(243), inset: 8pt, radius: 3pt, width: 100%)\n\
             #set table(stroke: 0.5pt + luma(160), inset: 6pt)\n\
             #show table.cell.where(y: 0): set text(weight: \"bold\")\n\
             #set figure(numbering: none)\n\
             #show figure.caption: set text(size: 10pt, fill: luma(100))\n\
             #show link: set text(fill: rgb(\"#2563eb\"))\n"
        ));
        if !document.title.trim().is_empty() {
            self.out.push_str(&format!(
                "#align(center, text(font: {heading}, size: 22pt, weight: \"bold\")[#{title}])\n\n"
            ));
        }
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
            let image = self.image(src, alt);
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
                self.inlines(inlines)
            ),
            Block::Paragraph(inlines) => self.inlines(inlines),
            Block::List { ordered, start, items } => {
                let items: Vec<String> = items.iter().map(|item| format!("[{}]", self.blocks(item, section))).collect();
                if *ordered {
                    format!("#enum(start: {start}, {})", items.join(", "))
                } else {
                    format!("#list({})", items.join(", "))
                }
            }
            Block::Quote(blocks) => format!(
                "#block(inset: (left: 10pt, y: 2pt), stroke: (left: 2pt + luma(200)))[#set text(fill: luma(80))\n{}]",
                self.blocks(blocks, section)
            ),
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
                let row = |writer: &mut Self, row: &[Vec<Inline>]| -> Vec<String> {
                    (0..columns)
                        .map(|i| format!("[{}]", writer.inlines(row.get(i).map_or(&[][..], Vec::as_slice))))
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

    fn inlines(&mut self, inlines: &[Inline]) -> String {
        let mut out = String::new();
        for inline in inlines {
            match inline {
                Inline::Text(text) => {
                    out.push('#');
                    out.push_str(&string(&breakable(text)));
                }
                Inline::Strong(children) => {
                    out.push_str(&format!("#strong[{}]", self.inlines(children)))
                }
                Inline::Emphasis(children) => {
                    out.push_str(&format!("#emph[{}]", self.inlines(children)))
                }
                Inline::Strike(children) => {
                    out.push_str(&format!("#strike[{}]", self.inlines(children)))
                }
                Inline::Code(code) => out.push_str(&format!("#raw({})", string(&breakable(code)))),
                Inline::Link { url, children } => {
                    let content = self.inlines(children);
                    if is_safe_url(url) {
                        out.push_str(&format!("#link({})[{content}]", string(url)));
                    } else {
                        out.push_str(&content);
                    }
                }
                Inline::Image { src, alt } => {
                    let image = self.image(src, alt);
                    out.push_str(&format!("#box({image})"));
                }
                Inline::SoftBreak => out.push_str("#\" \""),
                Inline::HardBreak => out.push_str("#linebreak()"),
            }
        }
        out
    }

    /// 图片表达式；无法加载时返回红色占位文字并记入报告。
    fn image(&mut self, src: &str, alt: &str) -> String {
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
        let (width, height) = display_size_pt(image.width, image.height, TEXT_WIDTH_PT);
        format!("image(\"/img/{index}.png\", width: {width:.2}pt, height: {height:.2}pt)")
    }
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

    #[test]
    fn tall_image_stays_on_the_page_with_its_heading() {
        let dir = project();
        write_image(
            &dir.path().join("assets/竖图.png"),
            400,
            1600,
            ImageFormat::Png,
        );
        let document = build(&request(
            "",
            &[("a", vec![1], "图片", "![竖图](../assets/竖图.png)")],
        ));
        let (pdf, _) = export(&document, dir.path(), system_fonts()).unwrap();
        // 按宽度缩放时这张图有 1200 磅高，会把标题单独留在第一页、图片挤到下一页。
        assert_eq!(page_count(&pdf), 1);
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
            chapter("c", vec![2], "方法", "![示意图](../assets/示意图.png)\n\n```\nfn main() {\n    println!(\"你好\");\n}\n```\n\n## 正文小标题\n\n访问 [官网](https://example.com)。\n\n1. 第一步\n2. 第二步"),
        ],
    };
    let (bytes, report) = export(&build(&request), &root, font_store(None)).unwrap();
    assert!(report.missing_images.is_empty());
    std::fs::write(out.join("sample.pdf"), bytes).unwrap();
}
