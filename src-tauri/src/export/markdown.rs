//! 合并的 Markdown 导出（docs/decisions.md 第 18 节）：整篇文档写成一个 Markdown 文件，供其他工具使用。
//!
//! - 章节标题写成 Markdown 标题（文档标题为一级，章节从二级开始，最深六级），带编号。
//! - Writer 自己的约定在这里转换为通用的写法：章节 / 图表引用写成文字（链接到标题的锚点在各工具中不一致，不生成），
//!   文献引用写成“[n]”并在末尾列出参考文献，图表编号写进图注与表格标题，脚注全文连续编号。公式保留 `$…$`。
//! - 图片复制到与 Markdown 文件同名的 `_assets` 文件夹，引用改为相对路径。

use std::collections::HashMap;
use std::path::Path;

use super::html::BIBLIOGRAPHY_TITLE;
use super::images::load_for_export;
use super::ExportReport;
use crate::render::chapter_reference::{broken_references, ref_text, ChapterTargets, RefShow};
use crate::render::citations::Citations;
use crate::render::elements::ElementTargets;
use crate::render::markdown::{Align, Block, Inline};
use crate::render::{resolve_image, Document};

const ELEMENT_SEPARATOR: &str = "\u{3000}";

/// 导出结果：Markdown 文本与要写在旁边的图片（相对路径、内容）。
pub struct MarkdownExport {
    pub text: String,
    pub images: Vec<(String, Vec<u8>)>,
    pub report: ExportReport,
}

struct Writer<'a> {
    root: &'a Path,
    assets: String,
    targets: ChapterTargets,
    elements: ElementTargets,
    citations: Citations,
    report: ExportReport,
    images: Vec<(String, Vec<u8>)>,
    /// 同一张图片只复制一次：原引用 → 新路径。
    copied: HashMap<String, String>,
    footnotes: Vec<String>,
}

/// 文字中有特殊含义的字符加反斜杠。
fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        if matches!(c, '\\' | '`' | '*' | '_' | '[' | ']' | '<' | '>' | '#' | '$' | '|' | '~') {
            out.push('\\');
        }
        out.push(c);
    }
    out
}

/// 行首可能被当作块结构的写法（列表、引用、标题、分隔线）加反斜杠。
fn escape_line_start(text: &str) -> String {
    let trimmed = text.trim_start();
    let first = trimmed.chars().next();
    if matches!(first, Some('-' | '+' | '=')) || trimmed.split_once(". ").is_some_and(|(n, _)| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit())) {
        format!("\\{trimmed}")
    } else {
        trimmed.to_owned()
    }
}

impl Writer<'_> {
    fn blocks(&mut self, blocks: &[Block], prefix: &str) -> String {
        let mut parts = Vec::new();
        for block in blocks {
            parts.push(self.block(block));
        }
        let joined = parts.join("\n\n");
        if prefix.is_empty() {
            return joined;
        }
        joined
            .lines()
            .map(|line| if line.is_empty() { prefix.trim_end().to_owned() } else { format!("{prefix}{line}") })
            .collect::<Vec<_>>()
            .join("\n")
    }

    fn block(&mut self, block: &Block) -> String {
        if let Some(tex) = block.as_math() {
            return format!("$$\n{tex}\n$$");
        }
        let element = self.elements.of(block).cloned();
        if let Some((src, alt)) = block.as_figure() {
            let caption = match &element {
                Some(target) => format!("{}{ELEMENT_SEPARATOR}{alt}", target.label),
                None => alt.to_owned(),
            };
            return self.image(src, &caption);
        }
        match block {
            Block::Paragraph(inlines) => escape_line_start(&self.inlines(inlines)),
            Block::List { ordered, start, items } => {
                let mut out = Vec::new();
                for (index, item) in items.iter().enumerate() {
                    let marker = if *ordered { format!("{}. ", *start as usize + index) } else { "- ".to_owned() };
                    let indent = " ".repeat(marker.len());
                    let body = self.blocks(item, "");
                    let mut lines = body.lines();
                    let first = lines.next().unwrap_or("");
                    let mut text = format!("{marker}{first}");
                    for line in lines {
                        text.push('\n');
                        if !line.is_empty() {
                            text.push_str(&indent);
                            text.push_str(line);
                        }
                    }
                    out.push(text);
                }
                out.join("\n")
            }
            Block::Quote(children) => self.blocks(children, "> "),
            Block::Code { language, text } => {
                let longest = text.split('\n').map(|line| line.chars().take_while(|&c| c == '`').count()).max().unwrap_or(0);
                let fence = "`".repeat(longest.max(2) + 1);
                format!("{fence}{}\n{text}\n{fence}", language.as_deref().unwrap_or(""))
            }
            Block::Table { alignments, header, rows, caption } => {
                let mut out = String::new();
                if let (Some(caption), Some(target)) = (caption, &element) {
                    out.push_str(&format!("**{}**\n\n", escape(&format!("{}{ELEMENT_SEPARATOR}{}", target.label, caption.text))));
                }
                let columns = header.len().max(rows.iter().map(Vec::len).max().unwrap_or(0)).max(1);
                let cell = |writer: &mut Self, cells: &[Vec<Inline>], i: usize| {
                    cells.get(i).map(|cell| writer.inlines(cell).replace('\n', " ")).unwrap_or_default()
                };
                let line = |cells: Vec<String>| format!("| {} |", cells.join(" | "));
                out.push_str(&line((0..columns).map(|i| cell(self, header, i)).collect()));
                out.push('\n');
                out.push_str(&line(
                    (0..columns)
                        .map(|i| match alignments.get(i) {
                            Some(Align::Left) => ":---".to_owned(),
                            Some(Align::Center) => ":---:".to_owned(),
                            Some(Align::Right) => "---:".to_owned(),
                            _ => "---".to_owned(),
                        })
                        .collect(),
                ));
                for row in rows {
                    out.push('\n');
                    out.push_str(&line((0..columns).map(|i| cell(self, row, i)).collect()));
                }
                out
            }
            Block::Rule => "---".to_owned(),
        }
    }

    fn image(&mut self, src: &str, alt: &str) -> String {
        if let Some(path) = self.copied.get(src) {
            return format!("![{}]({path})", escape(alt));
        }
        match resolve_image(self.root, src).and_then(|path| load_for_export(&path)) {
            Some(image) => {
                let jpeg = image.bytes.starts_with(&[0xff, 0xd8]);
                let name = format!("{}/image-{}.{}", self.assets, self.images.len() + 1, if jpeg { "jpg" } else { "png" });
                let encoded = name.replace(' ', "%20");
                self.images.push((name.clone(), image.bytes));
                self.copied.insert(src.to_owned(), encoded.clone());
                format!("![{}]({encoded})", escape(alt))
            }
            None => {
                self.report.missing_images.push(src.to_owned());
                escape(&format!("[图片无法显示：{}]", if alt.is_empty() { src } else { alt }))
            }
        }
    }

    fn inlines(&mut self, inlines: &[Inline]) -> String {
        let mut out = String::new();
        for inline in inlines {
            match inline {
                Inline::Text(text) => out.push_str(&escape(text)),
                Inline::Strong(children) => out.push_str(&format!("**{}**", self.inlines(children))),
                Inline::Emphasis(children) => out.push_str(&format!("*{}*", self.inlines(children))),
                Inline::Strike(children) => out.push_str(&format!("~~{}~~", self.inlines(children))),
                Inline::Code(code) => {
                    let longest = code.split(|c| c != '`').map(str::len).max().unwrap_or(0);
                    let ticks = "`".repeat(longest + 1);
                    let pad = if code.starts_with('`') || code.ends_with('`') { " " } else { "" };
                    out.push_str(&format!("{ticks}{pad}{code}{pad}{ticks}"));
                }
                Inline::Link { url, children } => {
                    let text = self.inlines(children);
                    out.push_str(&format!("[{text}](<{}>)", url.replace(['<', '>'], "")));
                }
                Inline::ChapterRef { target, cached } => match self.targets.get(target) {
                    Some(chapter) => {
                        let number = (!chapter.number.is_empty()).then_some(chapter.number.as_str());
                        let show = target.as_ref().map_or(RefShow::NumberTitle, |t| t.show);
                        out.push_str(&escape(&ref_text(number, &chapter.title, show)));
                    }
                    None => out.push_str(&escape(cached)),
                },
                Inline::ElementRef { kind, id, cached } => {
                    let text = self.elements.get(*kind, id).map_or_else(|| cached.clone(), |target| target.label.clone());
                    out.push_str(&escape(&text));
                }
                Inline::Citation { id, cached } => {
                    let text = self.citations.number(id).map_or_else(|| cached.clone(), |number| format!("[{number}]"));
                    out.push_str(&escape(&text));
                }
                Inline::Footnote(content) => {
                    let text = self.inlines(content);
                    self.footnotes.push(text);
                    out.push_str(&format!("[^{}]", self.footnotes.len()));
                }
                Inline::Math { tex, display } => {
                    if *display {
                        out.push_str(&format!("$${tex}$$"));
                    } else {
                        out.push_str(&format!("${}$", tex.trim()));
                    }
                }
                Inline::Image { src, alt, .. } => {
                    let image = self.image(src, alt);
                    out.push_str(&image);
                }
                Inline::SoftBreak => out.push(' '),
                Inline::HardBreak => out.push_str("\\\n"),
            }
        }
        out
    }
}

/// assets 是图片文件夹的名称（与 Markdown 文件同名加 `_assets`）。
pub fn export(document: &Document, root: &Path, assets: &str) -> MarkdownExport {
    let mut writer = Writer {
        root,
        assets: assets.to_owned(),
        targets: ChapterTargets::new(document),
        elements: ElementTargets::new(document),
        citations: Citations::new(document),
        report: ExportReport { broken_references: broken_references(document), ..ExportReport::default() },
        images: Vec::new(),
        copied: HashMap::new(),
        footnotes: Vec::new(),
    };
    let mut parts: Vec<String> = Vec::new();
    let title = document.title.trim();
    if !title.is_empty() {
        parts.push(format!("# {}", escape(title)));
    }
    for line in [document.subtitle.trim(), document.author.trim()] {
        if !line.is_empty() {
            parts.push(escape(line));
        }
    }
    let shift = usize::from(!title.is_empty());
    for section in &document.sections {
        let level = (section.depth + shift).clamp(1, 6);
        let heading = if section.number.is_empty() { section.title.clone() } else { format!("{} {}", section.number, section.title) };
        parts.push(format!("{} {}", "#".repeat(level), escape(&heading)));
        let body = writer.blocks(&section.blocks, "");
        if !body.is_empty() {
            parts.push(body);
        }
    }
    if !writer.citations.is_empty() {
        parts.push(format!("{} {BIBLIOGRAPHY_TITLE}", "#".repeat(1 + shift)));
        let list: Vec<String> = writer.citations.list().map(|(n, text)| format!("{}{}", escape(&format!("[{n}] ")), escape(text))).collect();
        parts.push(list.join("\\\n"));
    }
    let footnotes: Vec<String> = writer.footnotes.iter().enumerate().map(|(i, text)| format!("[^{}]: {text}", i + 1)).collect();
    if !footnotes.is_empty() {
        parts.push(footnotes.join("\n\n"));
    }
    let mut text = parts.join("\n\n");
    text.push('\n');
    MarkdownExport { text, images: writer.images, report: writer.report }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::{build, RenderChapter, RenderReference, RenderRequest};

    #[test]
    fn merged_markdown_resolves_writer_conventions() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join("assets")).unwrap();
        image::RgbImage::new(4, 2).save(dir.path().join("assets/a.png")).unwrap();
        let chapters = vec![
            RenderChapter { id: "a".into(), number: vec![1], title: "绪论".into(), markdown: "见[旧](writer:chapter/b)与[旧](writer:figure/f)，文献[[x]](writer:cite/r)。注[^1]\n\n[^1]: 甲\n\n![流程](../assets/a.png \"fig:f\")\n\n> - 引用中的列表\n\n$$x^2$$".into() },
            RenderChapter { id: "b".into(), number: vec![1, 1], title: "背景".into(), markdown: "价格 $5 与 *强调*。注[^1]\n\n[^1]: 乙".into() },
        ];
        let request = RenderRequest {
            title: "论文".into(),
            chapters,
            references: vec![RenderReference { id: "r".into(), text: "甲. 书[M].".into() }],
            ..Default::default()
        };
        let export = export(&build(&request), dir.path(), "论文_assets");
        let text = export.text;
        assert!(text.starts_with("# 论文\n\n## 1 绪论\n\n见1.1 背景与图 1-1，文献\\[1\\]。注[^1]"), "{text}");
        assert!(text.contains("![图 1-1\u{3000}流程](论文_assets/image-1.png)"), "{text}");
        assert!(text.contains("> - 引用中的列表"));
        assert!(text.contains("$$\nx^2\n$$"));
        assert!(text.contains("### 1.1 背景\n\n价格 \\$5 与 *强调*。注[^2]"), "{text}");
        assert!(text.contains("## 参考文献\n\n\\[1\\] 甲. 书\\[M\\]."), "{text}");
        assert!(text.ends_with("[^1]: 甲\n\n[^2]: 乙\n"), "{text}");
        assert_eq!(export.images.len(), 1);
        assert_eq!(export.images[0].0, "论文_assets/image-1.png");
    }
}
