//! EPUB 3 导出（docs/decisions.md 第 18 节）：每个一级章节（连同其子章节）一个 XHTML 文件，
//! 目录（nav）按章节树，封面信息、参考文献各一个文件；图片打包在 images/ 中，公式是内嵌的 SVG。
//! 正文与 HTML 导出共用 `export::html` 的渲染。

use std::io::{Cursor, Write};
use std::path::Path;

use zip::write::SimpleFileOptions;
use zip::{CompressionMethod, ZipWriter};

use super::html::{chapter_anchor, cover, escape, HtmlWriter, ImageSink, Locator, BIBLIOGRAPHY_TITLE, STYLESHEET};
use super::{ExportError, ExportReport};
use crate::render::Document;

/// 打包进 EPUB 的图片（文件名与内容）。
#[derive(Default)]
struct PackedImages {
    files: Vec<(String, Vec<u8>, &'static str)>,
}

impl ImageSink for PackedImages {
    fn image(&mut self, bytes: Vec<u8>, jpeg: bool) -> String {
        let (extension, media) = if jpeg { ("jpg", "image/jpeg") } else { ("png", "image/png") };
        let name = format!("images/img-{}.{extension}", self.files.len() + 1);
        self.files.push((name.clone(), bytes, media));
        name
    }
}

/// 章节所在的文件：一级章节（连同子章节）一个文件。
struct Files {
    /// 每个章节所在文件的序号。
    file_of_section: Vec<usize>,
}

const BIBLIOGRAPHY_FILE: &str = "bibliography.xhtml";

fn chapter_file(index: usize) -> String {
    format!("chapter-{}.xhtml", index + 1)
}

impl Locator for Files {
    fn file_of(&self, section: usize) -> String {
        match self.file_of_section.get(section) {
            Some(file) => chapter_file(*file),
            None => BIBLIOGRAPHY_FILE.to_owned(),
        }
    }
}

fn page(title: &str, body: &str) -> String {
    format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n<!DOCTYPE html>\n\
         <html xmlns=\"http://www.w3.org/1999/xhtml\" xmlns:epub=\"http://www.idpf.org/2007/ops\" xml:lang=\"zh-CN\" lang=\"zh-CN\">\n\
         <head><meta charset=\"utf-8\"/><title>{}</title><link rel=\"stylesheet\" type=\"text/css\" href=\"style.css\"/></head>\n<body>\n{body}</body>\n</html>\n",
        escape(title)
    )
}

pub fn export(document: &Document, root: &Path, now_iso: &str, identifier: &str) -> Result<(Vec<u8>, ExportReport), ExportError> {
    // 每个一级章节开始一个新文件。
    let mut file_of_section = Vec::with_capacity(document.sections.len());
    let mut files = 0usize;
    for section in &document.sections {
        if section.depth <= 1 || files == 0 {
            files += 1;
        }
        file_of_section.push(files - 1);
    }
    let locator = Files { file_of_section: file_of_section.clone() };
    let mut writer = HtmlWriter::new(document, root, PackedImages::default(), locator);

    let title = if document.title.trim().is_empty() { "文档" } else { document.title.trim() };
    let mut pages: Vec<(String, String, bool)> = Vec::new(); // 文件名、内容、是否含 SVG
    let cover_html = cover(document);
    if !cover_html.is_empty() {
        pages.push(("cover.xhtml".into(), page(title, &cover_html), false));
    }
    let mut current: Option<(usize, String)> = None;
    for (index, section) in document.sections.iter().enumerate() {
        let file = file_of_section[index];
        if current.as_ref().map(|(f, _)| *f) != Some(file) {
            if let Some((previous, body)) = current.take() {
                let body = body + &writer.take_footnotes();
                let svg = body.contains("<svg");
                pages.push((chapter_file(previous), page(title, &body), svg));
            }
            current = Some((file, String::new()));
        }
        let html = writer.section(index, section);
        current.as_mut().unwrap().1.push_str(&html);
    }
    if let Some((previous, body)) = current.take() {
        let body = body + &writer.take_footnotes();
        let svg = body.contains("<svg");
        pages.push((chapter_file(previous), page(title, &body), svg));
    }
    if writer.has_bibliography() {
        pages.push((BIBLIOGRAPHY_FILE.into(), page(title, &writer.bibliography()), false));
    }

    // 目录：按章节层级嵌套的列表。
    let mut nav = String::from("<nav epub:type=\"toc\" id=\"toc\"><h1>目录</h1>\n");
    let mut depth = 0usize;
    for (index, section) in document.sections.iter().enumerate() {
        let level = section.depth.max(1);
        if depth > 0 && level <= depth {
            // 关闭上一个条目，以及比这一级更深的列表。
            nav.push_str("</li>\n");
            while depth > level {
                nav.push_str("</ol></li>\n");
                depth -= 1;
            }
        }
        while depth < level {
            nav.push_str("<ol>\n");
            depth += 1;
        }
        let label = if section.number.is_empty() { section.title.clone() } else { format!("{} {}", section.number, section.title) };
        nav.push_str(&format!(
            "<li><a href=\"{}#{}\">{}</a>",
            chapter_file(file_of_section[index]),
            chapter_anchor(index),
            escape(&label)
        ));
    }
    if depth > 0 {
        nav.push_str("</li>\n");
        while depth > 1 {
            nav.push_str("</ol></li>\n");
            depth -= 1;
        }
        nav.push_str("</ol>\n");
    }
    if writer.has_bibliography() {
        nav.push_str(&format!("<ol><li><a href=\"{BIBLIOGRAPHY_FILE}\">{BIBLIOGRAPHY_TITLE}</a></li></ol>\n"));
    }
    nav.push_str("</nav>\n");
    let nav_page = page(title, &nav);

    let report = std::mem::take(&mut writer.report);
    let images = std::mem::take(&mut writer.images.files);

    let mut manifest = String::from(
        "<item id=\"nav\" href=\"nav.xhtml\" media-type=\"application/xhtml+xml\" properties=\"nav\"/>\n\
         <item id=\"css\" href=\"style.css\" media-type=\"text/css\"/>\n",
    );
    let mut spine = String::new();
    for (index, (name, _, svg)) in pages.iter().enumerate() {
        let properties = if *svg { " properties=\"svg\"" } else { "" };
        manifest.push_str(&format!("<item id=\"page-{index}\" href=\"{name}\" media-type=\"application/xhtml+xml\"{properties}/>\n"));
        spine.push_str(&format!("<itemref idref=\"page-{index}\"/>\n"));
    }
    for (index, (name, _, media)) in images.iter().enumerate() {
        manifest.push_str(&format!("<item id=\"image-{index}\" href=\"{name}\" media-type=\"{media}\"/>\n"));
    }
    let author = document.author.trim();
    let creator = if author.is_empty() { String::new() } else { format!("<dc:creator>{}</dc:creator>\n", escape(author)) };
    let opf = format!(
        "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
         <package xmlns=\"http://www.idpf.org/2007/opf\" version=\"3.0\" unique-identifier=\"uid\" xml:lang=\"zh-CN\">\n\
         <metadata xmlns:dc=\"http://purl.org/dc/elements/1.1/\">\n\
         <dc:identifier id=\"uid\">{}</dc:identifier>\n<dc:title>{}</dc:title>\n{creator}<dc:language>zh-CN</dc:language>\n\
         <meta property=\"dcterms:modified\">{now_iso}</meta>\n</metadata>\n\
         <manifest>\n{manifest}</manifest>\n<spine>\n{spine}</spine>\n</package>\n",
        escape(identifier),
        escape(title)
    );
    let container = "<?xml version=\"1.0\" encoding=\"UTF-8\"?>\n\
        <container version=\"1.0\" xmlns=\"urn:oasis:names:tc:opendocument:xmlns:container\">\n\
        <rootfiles><rootfile full-path=\"OEBPS/content.opf\" media-type=\"application/oebps-package+xml\"/></rootfiles>\n</container>\n";

    let zip_error = |error: zip::result::ZipError| ExportError::RenderFailed { message: error.to_string() };
    let io_error = |error: std::io::Error| ExportError::RenderFailed { message: error.to_string() };
    let mut zip = ZipWriter::new(Cursor::new(Vec::new()));
    // mimetype 必须是第一个、不压缩的文件。
    zip.start_file("mimetype", SimpleFileOptions::default().compression_method(CompressionMethod::Stored)).map_err(zip_error)?;
    zip.write_all(b"application/epub+zip").map_err(io_error)?;
    let deflate = SimpleFileOptions::default().compression_method(CompressionMethod::Deflated);
    let mut add = |name: &str, bytes: &[u8], options: SimpleFileOptions| -> Result<(), ExportError> {
        zip.start_file(name, options).map_err(zip_error)?;
        zip.write_all(bytes).map_err(io_error)
    };
    add("META-INF/container.xml", container.as_bytes(), deflate)?;
    add("OEBPS/content.opf", opf.as_bytes(), deflate)?;
    add("OEBPS/nav.xhtml", nav_page.as_bytes(), deflate)?;
    add("OEBPS/style.css", STYLESHEET.as_bytes(), deflate)?;
    for (name, content, _) in &pages {
        add(&format!("OEBPS/{name}"), content.as_bytes(), deflate)?;
    }
    let stored = SimpleFileOptions::default().compression_method(CompressionMethod::Stored);
    for (name, bytes, _) in &images {
        add(&format!("OEBPS/{name}"), bytes, stored)?;
    }
    let bytes = zip.finish().map_err(zip_error)?.into_inner();
    Ok((bytes, report))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::{build, RenderChapter, RenderRequest};
    use std::io::Read;

    fn chapter(id: &str, number: Vec<u32>, title: &str, markdown: &str) -> RenderChapter {
        RenderChapter { id: id.into(), number, title: title.into(), markdown: markdown.into() }
    }

    #[test]
    fn package_structure_files_per_top_level_chapter_and_cross_file_links() {
        let dir = tempfile::TempDir::new().unwrap();
        std::fs::create_dir_all(dir.path().join("assets")).unwrap();
        image::RgbImage::new(4, 2).save(dir.path().join("assets/a.png")).unwrap();
        let request = RenderRequest {
            title: "论文".into(),
            author: "张三".into(),
            chapters: vec![
                chapter("a", vec![1], "绪论", "见[旧](writer:chapter/b1)。\n\n![图](../assets/a.png)"),
                chapter("b", vec![2], "方法", "脚注[^1]\n\n[^1]: 说明"),
                chapter("b1", vec![2, 1], "设计", "正文"),
            ],
            ..Default::default()
        };
        let (bytes, report) = export(&build(&request), dir.path(), "2026-10-04T00:00:00Z", "urn:uuid:test").unwrap();
        assert!(report.missing_images.is_empty());
        let mut archive = zip::ZipArchive::new(Cursor::new(bytes)).unwrap();
        assert_eq!(archive.by_index(0).unwrap().name(), "mimetype");
        let names: Vec<String> = archive.file_names().map(str::to_owned).collect();
        for name in ["META-INF/container.xml", "OEBPS/content.opf", "OEBPS/nav.xhtml", "OEBPS/cover.xhtml", "OEBPS/chapter-1.xhtml", "OEBPS/chapter-2.xhtml", "OEBPS/images/img-1.png"] {
            assert!(names.iter().any(|n| n == name), "{name} in {names:?}");
        }
        assert!(!names.iter().any(|n| n == "OEBPS/chapter-3.xhtml"));
        let read = |archive: &mut zip::ZipArchive<Cursor<Vec<u8>>>, name: &str| {
            let mut text = String::new();
            archive.by_name(name).unwrap().read_to_string(&mut text).unwrap();
            text
        };
        let first = read(&mut archive, "OEBPS/chapter-1.xhtml");
        assert!(first.contains("<a href=\"chapter-2.xhtml#chapter-2\">2.1 设计</a>"), "{first}");
        assert!(first.contains("<img src=\"images/img-1.png\""));
        let second = read(&mut archive, "OEBPS/chapter-2.xhtml");
        assert!(second.contains("id=\"chapter-2\"") && second.contains("<li id=\"fn-1\""));
        let nav = read(&mut archive, "OEBPS/nav.xhtml");
        assert!(nav.contains("<a href=\"chapter-2.xhtml#chapter-2\">2.1 设计</a>"));
        assert_eq!(nav.matches("<ol>").count(), nav.matches("</ol>").count(), "{nav}");
        assert_eq!(nav.matches("<li>").count(), nav.matches("</li>").count(), "{nav}");
        assert!(nav.contains("2 方法</a><ol>\n<li><a href=\"chapter-2.xhtml#chapter-2\">2.1 设计</a></li>\n</ol></li>\n</ol>"), "{nav}");
        let opf = read(&mut archive, "OEBPS/content.opf");
        assert!(opf.contains("<dc:creator>张三</dc:creator>") && opf.contains("media-type=\"image/png\""));
    }
}
