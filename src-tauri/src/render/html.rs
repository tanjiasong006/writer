//! 全文预览的 HTML。所有文本都经过转义；图片以 `data-writer-src` 给出本地绝对路径，
//! 由前端转换成 webview 可访问的地址，渲染层不关心平台协议。

use std::fmt::Write;
use std::path::Path;

use super::markdown::{Align, Block, Inline};
use super::{resolve_image, Document, Section};

pub fn render(document: &Document, project_root: &Path) -> String {
    let mut out = String::new();
    let _ = write!(out, "<h1 class=\"doc-title\">{}</h1>", escape(&document.title));
    for section in &document.sections {
        render_section(&mut out, section, project_root);
    }
    out
}

fn render_section(out: &mut String, section: &Section, root: &Path) {
    let level = section.depth.clamp(1, 5) + 1;
    let _ = write!(
        out,
        "<section class=\"chapter\" data-chapter-id=\"{id}\">\
         <h{level} class=\"chapter-heading\"><span class=\"chapter-number\">{number}</span>{title}</h{level}>",
        id = escape(&section.chapter_id),
        number = escape(&section.number),
        title = escape(&section.title),
    );
    for block in &section.blocks {
        render_block(out, block, section, root);
    }
    out.push_str("</section>");
}

fn render_block(out: &mut String, block: &Block, section: &Section, root: &Path) {
    if let Some((src, alt)) = block.as_figure() {
        out.push_str("<figure>");
        render_image(out, src, alt, root);
        if !alt.is_empty() {
            let _ = write!(out, "<figcaption>{}</figcaption>", escape(alt));
        }
        out.push_str("</figure>");
        return;
    }
    match block {
        Block::Heading { level, inlines } => {
            let level = (section.body_heading_depth(*level) + 1).min(6);
            let _ = write!(out, "<h{level} class=\"body-heading\">");
            render_inlines(out, inlines, root);
            let _ = write!(out, "</h{level}>");
        }
        Block::Paragraph(inlines) => {
            out.push_str("<p>");
            render_inlines(out, inlines, root);
            out.push_str("</p>");
        }
        Block::List { ordered, start, items } => {
            if *ordered {
                let _ = write!(out, "<ol start=\"{start}\">");
            } else {
                out.push_str("<ul>");
            }
            for item in items {
                out.push_str("<li>");
                for block in item {
                    render_block(out, block, section, root);
                }
                out.push_str("</li>");
            }
            out.push_str(if *ordered { "</ol>" } else { "</ul>" });
        }
        Block::Quote(blocks) => {
            out.push_str("<blockquote>");
            for block in blocks {
                render_block(out, block, section, root);
            }
            out.push_str("</blockquote>");
        }
        Block::Code { text, .. } => {
            let _ = write!(out, "<pre><code>{}</code></pre>", escape(text));
        }
        Block::Table { alignments, header, rows } => {
            out.push_str("<table><thead><tr>");
            for (i, cell) in header.iter().enumerate() {
                render_cell(out, "th", cell, alignments.get(i), root);
            }
            out.push_str("</tr></thead><tbody>");
            for row in rows {
                out.push_str("<tr>");
                for (i, cell) in row.iter().enumerate() {
                    render_cell(out, "td", cell, alignments.get(i), root);
                }
                out.push_str("</tr>");
            }
            out.push_str("</tbody></table>");
        }
        Block::Rule => out.push_str("<hr>"),
    }
}

fn render_cell(out: &mut String, tag: &str, cell: &[Inline], align: Option<&Align>, root: &Path) {
    let style = match align {
        Some(Align::Left) => " style=\"text-align:left\"",
        Some(Align::Center) => " style=\"text-align:center\"",
        Some(Align::Right) => " style=\"text-align:right\"",
        _ => "",
    };
    let _ = write!(out, "<{tag}{style}>");
    render_inlines(out, cell, root);
    let _ = write!(out, "</{tag}>");
}

fn render_inlines(out: &mut String, inlines: &[Inline], root: &Path) {
    for inline in inlines {
        match inline {
            Inline::Text(text) => out.push_str(&escape(text)),
            Inline::Strong(children) => wrap(out, "strong", children, root),
            Inline::Emphasis(children) => wrap(out, "em", children, root),
            Inline::Strike(children) => wrap(out, "del", children, root),
            Inline::Code(code) => {
                let _ = write!(out, "<code>{}</code>", escape(code));
            }
            // 预览中链接只展示，不导航：webview 内跳转会离开应用。
            Inline::Link { url, children } => {
                let _ = write!(out, "<span class=\"link\" title=\"{}\">", escape(url));
                render_inlines(out, children, root);
                out.push_str("</span>");
            }
            Inline::Image { src, alt } => render_image(out, src, alt, root),
            Inline::SoftBreak => out.push(' '),
            Inline::HardBreak => out.push_str("<br>"),
        }
    }
}

fn wrap(out: &mut String, tag: &str, children: &[Inline], root: &Path) {
    let _ = write!(out, "<{tag}>");
    render_inlines(out, children, root);
    let _ = write!(out, "</{tag}>");
}

fn render_image(out: &mut String, src: &str, alt: &str, root: &Path) {
    match resolve_image(root, src) {
        Some(path) => {
            let _ = write!(
                out,
                "<img data-writer-src=\"{}\" alt=\"{}\">",
                escape(&path.to_string_lossy()),
                escape(alt)
            );
        }
        None => {
            let _ = write!(
                out,
                "<span class=\"missing-image\">图片无法显示：{}</span>",
                escape(if alt.is_empty() { src } else { alt })
            );
        }
    }
}

fn escape(text: &str) -> String {
    let mut out = String::with_capacity(text.len());
    for c in text.chars() {
        match c {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            '"' => out.push_str("&quot;"),
            '\'' => out.push_str("&#39;"),
            c => out.push(c),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::super::{build, RenderChapter, RenderRequest};
    use super::*;
    use std::fs;
    use tempfile::TempDir;

    fn render_chapters(root: &Path, chapters: &[(&str, Vec<u32>, &str, &str)]) -> String {
        let request = RenderRequest {
            title: "论文 <标题>".into(),
            chapters: chapters
                .iter()
                .map(|(id, number, title, markdown)| RenderChapter {
                    id: (*id).into(),
                    number: number.clone(),
                    title: (*title).into(),
                    markdown: (*markdown).into(),
                })
                .collect(),
        };
        render(&build(&request), root)
    }

    #[test]
    fn chapter_headings_come_from_structure() {
        let dir = TempDir::new().unwrap();
        let html = render_chapters(
            dir.path(),
            &[("a", vec![1], "绪论", "正文"), ("b", vec![1, 1], "背景", "## 小节")],
        );
        assert!(html.starts_with("<h1 class=\"doc-title\">论文 &lt;标题&gt;</h1>"));
        assert!(html.contains(
            "<section class=\"chapter\" data-chapter-id=\"a\"><h2 class=\"chapter-heading\"><span class=\"chapter-number\">1</span>绪论</h2><p>正文</p></section>"
        ));
        assert!(html.contains("<h3 class=\"chapter-heading\"><span class=\"chapter-number\">1.1</span>背景</h3>"));
        // 第 2 级章节里的 ## 标题：2 + 2 + 1 = 5 级 HTML 标题。
        assert!(html.contains("<h5 class=\"body-heading\">小节</h5>"));
    }

    #[test]
    fn everything_is_escaped() {
        let dir = TempDir::new().unwrap();
        let html = render_chapters(
            dir.path(),
            &[("x\"><script>", vec![1], "<img onerror=x>", "<script>alert(1)</script>\n\n`<b>`\n\n[a](javascript:alert(1))")],
        );
        assert!(!html.contains("<script>"));
        assert!(!html.contains("<img onerror"));
        assert!(!html.contains("<b>"));
        assert!(!html.contains("href"));
        assert!(html.contains("&lt;script&gt;alert(1)&lt;/script&gt;"));
    }

    #[test]
    fn images_resolve_to_local_paths_or_placeholders() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("项目");
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::create_dir_all(root.join("content")).unwrap();
        fs::write(root.join("assets/图.png"), b"x").unwrap();
        let html = render_chapters(
            &root,
            &[("a", vec![1], "图", "![装置](../assets/图.png)\n\n![丢失](../assets/无.png)")],
        );
        let expected = root.join("assets/图.png");
        assert!(html.contains(&format!(
            "<figure><img data-writer-src=\"{}\" alt=\"装置\"><figcaption>装置</figcaption></figure>",
            expected.display()
        )));
        assert!(html.contains("<span class=\"missing-image\">图片无法显示：丢失</span>"));
    }

    #[test]
    fn tables_and_lists() {
        let dir = TempDir::new().unwrap();
        let html = render_chapters(
            dir.path(),
            &[("a", vec![1], "表", "| a | b |\n| :-: | --: |\n| 1 | 2 |\n\n3. 三\n4. 四")],
        );
        assert!(html.contains("<table><thead><tr><th style=\"text-align:center\">a</th><th style=\"text-align:right\">b</th></tr></thead><tbody><tr><td style=\"text-align:center\">1</td><td style=\"text-align:right\">2</td></tr></tbody></table>"));
        assert!(html.contains("<ol start=\"3\"><li><p>三</p></li><li><p>四</p></li></ol>"));
    }

    #[test]
    fn empty_document() {
        let dir = TempDir::new().unwrap();
        assert_eq!(render_chapters(dir.path(), &[]), "<h1 class=\"doc-title\">论文 &lt;标题&gt;</h1>");
    }
}
