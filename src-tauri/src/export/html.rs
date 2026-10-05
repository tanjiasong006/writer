//! HTML 与 EPUB 的正文（docs/decisions.md 第 18 节）：从 `render::Document` 生成 XHTML 片段（HTML 与 EPUB 共用）。
//!
//! - 与 Word / PDF 相同的内容规则：章节标题带编号，章节 / 图表引用是链接（文字按当前结构生成），
//!   图表编号、脚注、文献引用与参考文献表、公式（Typst 排版为 SVG）。
//! - 输出是合法的 XHTML（自闭合标签、转义），EPUB 可以直接使用。
//! - 图片交给调用方决定如何引用（HTML 内嵌为 data URI，EPUB 打包为文件）；无法读取的图片输出占位文字并计入报告。

use std::collections::HashMap;
use std::path::Path;

use super::images::load_for_export;
use super::{math, ExportReport};
use crate::render::chapter_reference::{broken_references, ref_text, ChapterTargets, RefShow};
use crate::render::citations::Citations;
use crate::render::elements::ElementTargets;
use crate::render::markdown::{Align, Block, Inline};
use crate::render::{resolve_image, Document, Section, StructureImage};

/// 图表编号与图注之间的分隔（与 Word / PDF 相同）。
const ELEMENT_SEPARATOR: &str = "\u{3000}";
/// 参考文献表的标题。
pub const BIBLIOGRAPHY_TITLE: &str = "参考文献";

/// 图片的输出方式：返回 img 的 src，失败时为 None。
pub trait ImageSink {
    fn image(&mut self, bytes: Vec<u8>, jpeg: bool) -> String;
}

/// 章节在输出中的位置：HTML 是同一个文件，EPUB 是按一级章节分的文件。
pub trait Locator {
    /// 第 index 个章节所在的文件（同一文件时为空串）。
    fn file_of(&self, section: usize) -> String;
}

pub struct HtmlWriter<'a, S: ImageSink, L: Locator> {
    root: &'a Path,
    targets: ChapterTargets,
    elements: ElementTargets,
    citations: Citations,
    /// 化学结构式的图片（docs/decisions.md 第 22 节）与已输出的地址（同一结构式只输出一次）。
    structures: HashMap<String, StructureImage>,
    structure_urls: HashMap<String, String>,
    /// 每个章节的序号（锚点名）。
    section_index: HashMap<String, usize>,
    pub report: ExportReport,
    pub images: S,
    locator: L,
    /// 当前文件中的脚注（编号, 内容 HTML）。
    footnotes: Vec<(usize, String)>,
    next_footnote: usize,
    current_section: usize,
}

pub fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c if (c as u32) < 0x20 && !matches!(c, '\t' | '\n' | '\r') => {}
            '\u{FFFE}' | '\u{FFFF}' => {}
            c => out.push(c),
        }
    }
    out
}

fn is_safe_url(url: &str) -> bool {
    let lower = url.to_ascii_lowercase();
    lower.starts_with("http://") || lower.starts_with("https://") || lower.starts_with("mailto:")
}

pub fn chapter_anchor(index: usize) -> String {
    format!("chapter-{index}")
}

impl<'a, S: ImageSink, L: Locator> HtmlWriter<'a, S, L> {
    pub fn new(document: &Document, root: &'a Path, images: S, locator: L) -> Self {
        HtmlWriter {
            root,
            targets: ChapterTargets::new(document),
            elements: ElementTargets::new(document),
            citations: Citations::new(document),
            structures: document.structures.clone(),
            structure_urls: HashMap::new(),
            section_index: document
                .sections
                .iter()
                .enumerate()
                .map(|(index, section)| (section.chapter_id.clone(), index))
                .collect(),
            report: ExportReport {
                broken_references: broken_references(document),
                ..ExportReport::default()
            },
            images,
            locator,
            footnotes: Vec::new(),
            next_footnote: 1,
            current_section: 0,
        }
    }

    fn link(&self, section: usize, anchor: &str) -> String {
        let file = self.locator.file_of(section);
        let here = self.locator.file_of(self.current_section);
        if file == here { format!("#{anchor}") } else { format!("{file}#{anchor}") }
    }

    /// 一个章节：标题（h1–h6，带编号与锚点）与正文。
    pub fn section(&mut self, index: usize, section: &Section) -> String {
        self.current_section = index;
        let level = section.depth.clamp(1, 6);
        let number = if section.number.is_empty() {
            String::new()
        } else {
            format!("<span class=\"number\">{}</span> ", escape(&section.number))
        };
        let mut out = format!(
            "<h{level} id=\"{}\">{number}{}</h{level}>\n",
            chapter_anchor(index),
            escape(&section.title)
        );
        out.push_str(&self.blocks(&section.blocks));
        out
    }

    /// 当前文件末尾的脚注列表（之后清空）。
    pub fn take_footnotes(&mut self) -> String {
        if self.footnotes.is_empty() {
            return String::new();
        }
        let mut out = String::from("<section class=\"footnotes\" epub:type=\"footnotes\"><hr/><ol>\n");
        for (number, content) in self.footnotes.drain(..) {
            out.push_str(&format!(
                "<li id=\"fn-{number}\" value=\"{number}\" epub:type=\"footnote\">{content} <a href=\"#fnref-{number}\" class=\"backref\">↩</a></li>\n"
            ));
        }
        out.push_str("</ol></section>\n");
        out
    }

    /// 参考文献表（被引用的条目，按编号）；没有引用时为空。
    pub fn bibliography(&self) -> String {
        if self.citations.is_empty() {
            return String::new();
        }
        let mut out = format!("<h1 id=\"bibliography\">{}</h1>\n<ol class=\"bibliography\">\n", BIBLIOGRAPHY_TITLE);
        for (number, text) in self.citations.list() {
            out.push_str(&format!("<li id=\"cite-{number}\"><span class=\"cite-number\">[{number}]</span> {}</li>\n", escape(text)));
        }
        out.push_str("</ol>\n");
        out
    }

    pub fn has_bibliography(&self) -> bool {
        !self.citations.is_empty()
    }

    fn blocks(&mut self, blocks: &[Block]) -> String {
        blocks.iter().map(|block| self.block(block)).collect()
    }

    fn block(&mut self, block: &Block) -> String {
        if let Some(tex) = block.as_math() {
            return format!("<div class=\"math-block\">{}</div>\n", self.math(tex, true));
        }
        let element = self.elements.of(block).cloned();
        if let Some((src, alt)) = block.as_figure() {
            let id = element.as_ref().map(|t| format!(" id=\"element-{}\"", t.anchor)).unwrap_or_default();
            let caption = match &element {
                Some(target) => format!("{}{ELEMENT_SEPARATOR}{alt}", target.label),
                None => alt.to_owned(),
            };
            let caption = if caption.is_empty() {
                String::new()
            } else {
                format!("<figcaption>{}</figcaption>", escape(&caption))
            };
            return format!("<figure{id}>{}{caption}</figure>\n", self.image(src, alt));
        }
        match block {
            Block::Paragraph(inlines) => format!("<p>{}</p>\n", self.inlines(inlines)),
            Block::List { ordered, start, items } => {
                let tag = if *ordered { "ol" } else { "ul" };
                let start = if *ordered && *start != 1 { format!(" start=\"{start}\"") } else { String::new() };
                let items: String = items.iter().map(|item| format!("<li>{}</li>\n", self.blocks(item))).collect();
                format!("<{tag}{start}>\n{items}</{tag}>\n")
            }
            Block::Quote(children) => format!("<blockquote>\n{}</blockquote>\n", self.blocks(children)),
            Block::Code { language, text } => {
                let class = language.as_deref().map(|l| format!(" class=\"language-{}\"", escape(l))).unwrap_or_default();
                format!("<pre><code{class}>{}</code></pre>\n", escape(text))
            }
            Block::Structure { smiles } => self.structure(smiles),
            Block::Table { alignments, header, rows, caption } => {
                let caption = match (caption, &element) {
                    (Some(caption), Some(target)) => format!(
                        "<caption id=\"element-{}\">{}</caption>",
                        target.anchor,
                        escape(&format!("{}{ELEMENT_SEPARATOR}{}", target.label, caption.text))
                    ),
                    _ => String::new(),
                };
                let align = |i: usize| match alignments.get(i) {
                    Some(Align::Left) => " style=\"text-align: left\"",
                    Some(Align::Center) => " style=\"text-align: center\"",
                    Some(Align::Right) => " style=\"text-align: right\"",
                    _ => "",
                };
                let head: String = header
                    .iter()
                    .enumerate()
                    .map(|(i, cell)| format!("<th{}>{}</th>", align(i), self.inlines(cell)))
                    .collect();
                let body: String = rows
                    .iter()
                    .map(|row| {
                        let cells: String = row
                            .iter()
                            .enumerate()
                            .map(|(i, cell)| format!("<td{}>{}</td>", align(i), self.inlines(cell)))
                            .collect();
                        format!("<tr>{cells}</tr>\n")
                    })
                    .collect();
                format!("<table>{caption}<thead><tr>{head}</tr></thead>\n<tbody>\n{body}</tbody></table>\n")
            }
            Block::Rule => "<hr/>\n".to_owned(),
        }
    }

    /// 化学结构式：前端画好的图片，按其显示尺寸（宽度不超过正文）；没有图片时是红色的 SMILES 原文并列入报告。
    fn structure(&mut self, smiles: &str) -> String {
        let Some(image) = self.structures.get(smiles) else {
            self.report.invalid_structures.push(smiles.to_owned());
            return format!("<figure class=\"structure\"><code class=\"structure-invalid\">{}</code></figure>\n", escape(smiles));
        };
        let width = image.width_pt;
        let url = match self.structure_urls.get(smiles) {
            Some(url) => url.clone(),
            None => {
                let url = self.images.image(image.png.clone(), false);
                self.structure_urls.insert(smiles.to_owned(), url.clone());
                url
            }
        };
        format!(
            "<figure class=\"structure\"><img src=\"{}\" alt=\"{}\" style=\"width: {width:.1}pt\"/></figure>\n",
            escape(&url),
            escape(smiles)
        )
    }

    fn image(&mut self, src: &str, alt: &str) -> String {
        let image = resolve_image(self.root, src).and_then(|path| load_for_export(&path));
        match image {
            Some(image) => {
                let jpeg = image.bytes.starts_with(&[0xff, 0xd8]);
                let url = self.images.image(image.bytes, jpeg);
                format!("<img src=\"{}\" alt=\"{}\"/>", escape(&url), escape(alt))
            }
            None => {
                self.report.missing_images.push(src.to_owned());
                let label = if alt.is_empty() { src } else { alt };
                format!("<span class=\"missing\">[图片无法显示：{}]</span>", escape(label))
            }
        }
    }

    fn math(&mut self, tex: &str, display: bool) -> String {
        let fonts = super::pdf::font_store(None);
        match math::render_svg(tex, display, 12.0, fonts) {
            Some((svg, width, height)) => {
                // 尺寸按正文字号（12pt = 1em）换算，随阅读器字号缩放。
                let svg = svg.trim_start_matches("<?xml version=\"1.0\" encoding=\"UTF-8\"?>").trim();
                let svg = svg.replacen(
                    "<svg ",
                    &format!("<svg style=\"width: {:.3}em; height: {:.3}em\" role=\"img\" aria-label=\"{}\" ", width / 12.0, height / 12.0, escape(tex.trim())),
                    1,
                );
                format!("<span class=\"math\">{svg}</span>")
            }
            None => {
                self.report.invalid_formulas.push(tex.trim().to_owned());
                format!("<code class=\"math-invalid\">{}</code>", escape(tex.trim()))
            }
        }
    }

    fn inlines(&mut self, inlines: &[Inline]) -> String {
        let mut out = String::new();
        for inline in inlines {
            match inline {
                Inline::Text(text) => out.push_str(&escape(text)),
                Inline::Strong(children) => out.push_str(&format!("<strong>{}</strong>", self.inlines(children))),
                Inline::Emphasis(children) => out.push_str(&format!("<em>{}</em>", self.inlines(children))),
                Inline::Strike(children) => out.push_str(&format!("<del>{}</del>", self.inlines(children))),
                Inline::Superscript(children) => out.push_str(&format!("<sup>{}</sup>", self.inlines(children))),
                Inline::Subscript(children) => out.push_str(&format!("<sub>{}</sub>", self.inlines(children))),
                Inline::Code(code) => out.push_str(&format!("<code>{}</code>", escape(code))),
                Inline::Link { url, children } => {
                    let content = self.inlines(children);
                    if is_safe_url(url) {
                        out.push_str(&format!("<a href=\"{}\">{content}</a>", escape(url)));
                    } else {
                        out.push_str(&content);
                    }
                }
                Inline::ChapterRef { target, cached } => match self.targets.get(target) {
                    Some(chapter) => {
                        let number = (!chapter.number.is_empty()).then_some(chapter.number.as_str());
                        let show = target.as_ref().map_or(RefShow::NumberTitle, |t| t.show);
                        let text = ref_text(number, &chapter.title, show);
                        let index = self.section_index.get(&target.as_ref().unwrap().id).copied().unwrap_or(chapter.index);
                        out.push_str(&format!("<a href=\"{}\">{}</a>", self.link(index, &chapter_anchor(index)), escape(&text)));
                    }
                    None => out.push_str(&escape(cached)),
                },
                Inline::ElementRef { kind, id, cached } => match self.elements.get(*kind, id) {
                    Some(target) => out.push_str(&format!(
                        "<a href=\"{}\">{}</a>",
                        self.link(target.section, &format!("element-{}", target.anchor)),
                        escape(&target.label)
                    )),
                    None => out.push_str(&escape(cached)),
                },
                Inline::Citation { id, cached } => match self.citations.number(id) {
                    Some(number) => {
                        let file = self.locator.file_of(usize::MAX);
                        let here = self.locator.file_of(self.current_section);
                        let href = if file == here { format!("#cite-{number}") } else { format!("{file}#cite-{number}") };
                        out.push_str(&format!("<sup class=\"citation\"><a href=\"{href}\">[{number}]</a></sup>"))
                    }
                    None => out.push_str(&escape(cached)),
                },
                Inline::Footnote(content) => {
                    let number = self.next_footnote;
                    self.next_footnote += 1;
                    let html = self.inlines(content);
                    self.footnotes.push((number, html));
                    out.push_str(&format!(
                        "<sup class=\"footnote-ref\"><a id=\"fnref-{number}\" href=\"#fn-{number}\" epub:type=\"noteref\">{number}</a></sup>"
                    ));
                }
                Inline::Math { tex, display } => out.push_str(&self.math(tex, *display)),
                Inline::Image { src, alt, .. } => out.push_str(&self.image(src, alt)),
                Inline::SoftBreak => out.push(' '),
                Inline::HardBreak => out.push_str("<br/>"),
            }
        }
        out
    }
}

/// 输出的样式：安静的阅读排版（与编辑器的正文相近），HTML 与 EPUB 共用。
pub const STYLESHEET: &str = r#"
body { margin: 0 auto; max-width: 42em; padding: 2em 1.5em 4em; font-family: "Songti SC", "Noto Serif CJK SC", "SimSun", serif; font-size: 1.05em; line-height: 1.8; color: #1f1f21; }
h1, h2, h3, h4, h5, h6 { font-family: "PingFang SC", "Noto Sans CJK SC", "Microsoft YaHei", sans-serif; line-height: 1.4; margin: 1.8em 0 0.6em; }
h1 { font-size: 1.6em; } h2 { font-size: 1.35em; } h3 { font-size: 1.15em; } h4, h5, h6 { font-size: 1em; }
.number { color: #8a8a8f; font-weight: normal; margin-right: 0.3em; }
header.cover { text-align: center; margin: 4em 0 3em; }
header.cover h1 { font-size: 2em; margin: 0; }
header.cover .subtitle { font-size: 1.2em; color: #5c5c61; margin-top: 0.6em; }
header.cover .author { color: #5c5c61; margin-top: 2em; }
p { margin: 0.6em 0; text-align: justify; }
blockquote { margin: 1em 0; padding-left: 1em; border-left: 2px solid #d8d8d4; color: #55555a; font-family: "Kaiti SC", "KaiTi", serif; }
pre { background: #f3f3f1; padding: 0.8em 1em; overflow-x: auto; border-radius: 4px; }
code { font-family: Menlo, Consolas, monospace; font-size: 0.9em; }
figure { margin: 1.5em 0; text-align: center; }
figure img, p img { max-width: 100%; height: auto; }
figcaption, caption { color: #55555a; font-size: 0.9em; margin-top: 0.4em; }
table { border-collapse: collapse; margin: 1.5em auto; border-top: 1.5px solid #333; border-bottom: 1.5px solid #333; }
caption { caption-side: top; margin-bottom: 0.4em; }
th, td { padding: 0.35em 0.8em; }
thead th { border-bottom: 1px solid #333; }
hr { border: none; border-top: 1px solid #ccc; width: 30%; margin: 2em auto; }
a { color: #2f4b74; }
.math svg { vertical-align: middle; }
.math-block { text-align: center; margin: 1em 0; }
.math-invalid, .missing, .structure-invalid { color: #b91c1c; }
.footnotes { font-size: 0.9em; color: #55555a; margin-top: 2em; }
.footnotes hr { width: 30%; margin: 1em 0; }
.footnote-ref a, .citation a { text-decoration: none; }
.bibliography { list-style: none; padding-left: 0; }
.bibliography li { padding-left: 2.5em; text-indent: -2.5em; margin: 0.3em 0; }
@media (prefers-color-scheme: dark) {
  body { background: #1e1e20; color: #e2e2e4; }
  pre { background: #2a2a2d; }
  a { color: #a8bcda; }
  figcaption, caption, blockquote, .footnotes, header.cover .subtitle, header.cover .author { color: #a2a2a7; }
  table, thead th { border-color: #aaa; }
}
"#;

/// 封面（标题、副标题、作者）；全部为空时为空串。
pub fn cover(document: &Document) -> String {
    let title = document.title.trim();
    let subtitle = document.subtitle.trim();
    let author = document.author.trim();
    if title.is_empty() && subtitle.is_empty() && author.is_empty() {
        return String::new();
    }
    let mut out = String::from("<header class=\"cover\">\n");
    if !title.is_empty() {
        out.push_str(&format!("<h1>{}</h1>\n", escape(title)));
    }
    if !subtitle.is_empty() {
        out.push_str(&format!("<p class=\"subtitle\">{}</p>\n", escape(subtitle)));
    }
    if !author.is_empty() {
        out.push_str(&format!("<p class=\"author\">{}</p>\n", escape(author)));
    }
    out.push_str("</header>\n");
    out
}

/// 单个 HTML 文件中的图片：内嵌为 data URI。
pub struct InlineImages;

impl ImageSink for InlineImages {
    fn image(&mut self, bytes: Vec<u8>, jpeg: bool) -> String {
        use base64_engine::encode;
        format!("data:image/{};base64,{}", if jpeg { "jpeg" } else { "png" }, encode(&bytes))
    }
}

/// 单个文件：所有章节在同一处。
pub struct SingleFile;

impl Locator for SingleFile {
    fn file_of(&self, _section: usize) -> String {
        String::new()
    }
}

/// 导出为一个独立的 HTML 文件（图片内嵌，样式内嵌）。
pub fn export(document: &Document, root: &Path) -> (Vec<u8>, ExportReport) {
    let mut writer = HtmlWriter::new(document, root, InlineImages, SingleFile);
    let mut body = cover(document);
    for (index, section) in document.sections.iter().enumerate() {
        body.push_str(&writer.section(index, section));
    }
    body.push_str(&writer.take_footnotes());
    body.push_str(&writer.bibliography());
    let title = if document.title.trim().is_empty() { "文档" } else { document.title.trim() };
    let html = format!(
        "<!DOCTYPE html>\n<html lang=\"zh-CN\" xmlns:epub=\"http://www.idpf.org/2007/ops\">\n<head>\n<meta charset=\"utf-8\"/>\n\
         <meta name=\"viewport\" content=\"width=device-width, initial-scale=1\"/>\n<title>{}</title>\n<style>{STYLESHEET}</style>\n</head>\n<body>\n{body}</body>\n</html>\n",
        escape(title)
    );
    (html.into_bytes(), writer.report)
}

/// 最小的 base64 编码（避免为此增加依赖）。
mod base64_engine {
    const TABLE: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

    pub fn encode(bytes: &[u8]) -> String {
        let mut out = String::with_capacity(bytes.len().div_ceil(3) * 4);
        for chunk in bytes.chunks(3) {
            let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
            let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
            out.push(TABLE[(n >> 18) as usize & 63] as char);
            out.push(TABLE[(n >> 12) as usize & 63] as char);
            out.push(if chunk.len() > 1 { TABLE[(n >> 6) as usize & 63] as char } else { '=' });
            out.push(if chunk.len() > 2 { TABLE[n as usize & 63] as char } else { '=' });
        }
        out
    }

    #[cfg(test)]
    #[test]
    fn encodes_like_the_standard() {
        assert_eq!(encode(b""), "");
        assert_eq!(encode(b"f"), "Zg==");
        assert_eq!(encode(b"fo"), "Zm8=");
        assert_eq!(encode(b"foobar"), "Zm9vYmFy");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::{build, RenderChapter, RenderReference, RenderRequest};

    fn chapter(id: &str, number: Vec<u32>, title: &str, markdown: &str) -> RenderChapter {
        RenderChapter { id: id.into(), number, title: title.into(), markdown: markdown.into() }
    }

    #[test]
    fn single_file_with_headings_references_footnotes_citations_and_escaping() {
        let dir = tempfile::TempDir::new().unwrap();
        let request = RenderRequest {
            title: "论文 <A&B>".into(),
            chapters: vec![
                chapter("a", vec![1], "绪论", "见[旧](writer:chapter/b)与[[1]](writer:cite/r)。脚注[^1]。\n\n[^1]: 注释 *斜*\n\n<script>x</script>"),
                chapter("b", vec![2], "方法", "| 甲 |\n| - |\n| $x$ |\n\n![缺](../assets/none.png)\n\nm<sup>3</sup>/d，H<sub>2</sub>O"),
            ],
            references: vec![RenderReference { id: "r".into(), text: "甲. 书[M]. 2020.".into() }],
            ..Default::default()
        };
        let (bytes, report) = export(&build(&request), dir.path());
        let html = String::from_utf8(bytes).unwrap();
        assert!(html.contains("<title>论文 &lt;A&amp;B&gt;</title>"));
        assert!(html.contains("<h1 id=\"chapter-0\"><span class=\"number\">1</span> 绪论</h1>"), "{html}");
        assert!(html.contains("<a href=\"#chapter-1\">2 方法</a>"));
        assert!(html.contains("<sup class=\"citation\"><a href=\"#cite-1\">[1]</a></sup>"));
        assert!(html.contains("href=\"#fn-1\"") && html.contains("<li id=\"fn-1\" value=\"1\" epub:type=\"footnote\">注释 <em>斜</em>"));
        assert!(html.contains("&lt;script&gt;x&lt;/script&gt;"));
        assert!(html.contains("m<sup>3</sup>/d，H<sub>2</sub>O"), "{html}");
        assert!(html.contains("<li id=\"cite-1\"><span class=\"cite-number\">[1]</span> 甲. 书[M]. 2020.</li>"));
        assert!(html.contains("<span class=\"math\"><svg"), "formula rendered as svg");
        assert_eq!(report.missing_images, vec!["../assets/none.png"]);
    }

    /// 化学结构式（docs/decisions.md 第 22 节）：图片按显示尺寸；没有图片的以原文输出并列入报告。
    #[test]
    fn structures_are_images_and_missing_ones_fall_back_to_smiles() {
        let dir = tempfile::TempDir::new().unwrap();
        let request = RenderRequest {
            chapters: vec![chapter("a", vec![1], "结构", "```smiles\nCCO\n```\n\n```smiles\nC1CC(\n```")],
            structures: vec![crate::render::tests::test_structure("CCO")],
            ..Default::default()
        };
        let (bytes, report) = export(&build(&request), dir.path());
        let html = String::from_utf8(bytes).unwrap();
        assert!(html.contains("<figure class=\"structure\"><img src=\"data:image/png;base64,"), "{html}");
        assert!(html.contains("alt=\"CCO\" style=\"width: 30.0pt\""), "{html}");
        assert!(html.contains("<code class=\"structure-invalid\">C1CC(</code>"));
        assert_eq!(report.invalid_structures, vec!["C1CC("]);
    }
}
