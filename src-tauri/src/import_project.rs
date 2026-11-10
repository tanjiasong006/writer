//! Convert the loss-aware DOCX intermediate representation into a Writer project.
use crate::import_docx::{self, Block, ImportedDocument, Inline};
use crate::storage::{self, fs::RealFs, OpenedProject, SaveRequest, StorageError};
use serde::Serialize;
use serde_json::json;
use std::collections::{BTreeMap, HashMap};
use std::path::Path;

#[derive(Debug, Serialize)]
#[serde(tag = "code", rename_all = "kebab-case")]
pub enum ImportError {
    InvalidDocx { detail: String },
    Storage { error: StorageError },
}
impl From<StorageError> for ImportError {
    fn from(error: StorageError) -> Self {
        Self::Storage { error }
    }
}
#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub project: OpenedProject,
    pub warnings: Vec<&'static str>,
    pub warning_details: Vec<import_docx::WarningDetail>,
}

#[derive(Serialize)]
struct Chapter {
    id: String,
    title: String,
    children: Vec<Chapter>,
}
fn insert(nodes: &mut Vec<Chapter>, path: &[usize], chapter: Chapter) {
    if let Some((&i, rest)) = path.split_first() {
        insert(&mut nodes[i].children, rest, chapter);
    } else {
        nodes.push(chapter);
    }
}
fn siblings<'a>(nodes: &'a [Chapter], path: &[usize]) -> &'a [Chapter] {
    if let Some((&i, rest)) = path.split_first() {
        siblings(&nodes[i].children, rest)
    } else {
        nodes
    }
}
fn plain(block: &Block) -> String {
    block
        .inlines
        .iter()
        .map(|i| match i {
            Inline::Text { text, .. } => text.as_str(),
            Inline::Break | Inline::Tab => " ",
            Inline::Image(_) | Inline::Table(_) => "",
        })
        .collect()
}
// Require a complete hierarchy and at least two headings as evidence.
fn heading_titles(doc: &ImportedDocument) -> Option<Vec<String>> {
    if doc.heading_numbering_possible { return None; }
    let mut numbers: Vec<usize> = Vec::new();
    let mut titles = Vec::new();
    let mut numbered_count = 0;
    let mut in_appendix = false;
    for block in &doc.blocks {
        let Some(level) = block.heading_level else { continue };
        let text = plain(block);
        // Lettered appendices and their descendants retain their source titles.
        if level == 1 {
            if let Some(rest) = text.strip_prefix("附录") {
                let rest = rest.trim_start();
                if rest.chars().next().is_some_and(|c| c.is_ascii_uppercase())
                    && rest.chars().nth(1).is_none_or(|c| c.is_whitespace() || c.is_ascii_punctuation()) {
                    in_appendix = true;
                }
            }
        }
        if in_appendix {
            titles.push(text);
            continue;
        }
        // Flattening non-text content can hide material between the apparent prefix and
        // title. In that case the literal number is not reliably distinguishable.
        if block.list.is_some() || block.inlines.iter().any(|inline| !matches!(inline, Inline::Text { .. } | Inline::Tab)) {
            return None;
        }
        let depth = usize::from(level);
        if depth == 0 || depth > numbers.len() + 1 { return None; }
        numbers.truncate(depth);
        if numbers.len() < depth { numbers.push(1); }
        else { *numbers.last_mut()? += 1; }
        let prefix = numbers.iter().map(usize::to_string).collect::<Vec<_>>().join(".");
        let tail = text.strip_prefix(&prefix)?;
        let tail = tail.strip_prefix('.').unwrap_or(tail);
        if !tail.starts_with(char::is_whitespace) { return None; }
        let title = tail.trim_start();
        if title.is_empty() { return None; }
        titles.push(title.to_owned());
        numbered_count += 1;
    }
    (numbered_count >= 2).then_some(titles)
}
fn escape(s: &str) -> String {
    let mut out = String::new();
    for c in s.chars() {
        if matches!(c, '\t' | '\n' | '\r') {
            out.push_str(&format!("&#{};", c as u32));
            continue;
        }
        if "\\`*_{}[]<>()#+-.!|>~$&^:".contains(c) {
            out.push('\\');
        }
        out.push(c);
    }
    out
}
// Character references keep boundary whitespace from becoming Markdown indentation or
// being discarded at paragraph edges. They also preserve DOCX tabs as text.
fn whitespace(s: &str) -> String {
    s.chars().map(|c| format!("&#{};", c as u32)).collect()
}
fn markdown(block: &Block, assets: &[String]) -> String {
    let mut s = String::new();
    // Entity boundaries are punctuation in Markdown source, allowing delimiter runs
    // to flank formatted punctuation even when it is adjacent to a word.
    let punctuation_boundary = block.inlines.iter().any(|inline| match inline {
        Inline::Text { text, bold, italic, strike } if *bold || *italic || *strike => {
            let text = text.trim();
            text.chars().next().is_some_and(|c| !c.is_alphanumeric())
                || text.chars().next_back().is_some_and(|c| !c.is_alphanumeric())
        }
        _ => false,
    });
    for inline in &block.inlines {
        match inline {
            Inline::Text {
                text,
                bold,
                italic,
                strike,
            } => {
                let leading = text.len() - text.trim_start().len();
                if leading == text.len() {
                    s.push_str(&whitespace(text));
                    continue;
                }
                let trailing = text.len() - text.trim_end().len();
                s.push_str(&whitespace(&text[..leading]));
                if *bold {
                    s.push_str("**");
                }
                if *italic {
                    s.push('*');
                }
                if *strike {
                    s.push_str("~~");
                }
                let content = &text[leading..text.len() - trailing];
                if punctuation_boundary { s.push_str(&whitespace(content)); }
                else { s.push_str(&escape(content)); }
                if *strike {
                    s.push_str("~~");
                }
                if *italic {
                    s.push('*');
                }
                if *bold {
                    s.push_str("**");
                }
                s.push_str(&whitespace(&text[text.len() - trailing..]));
            }
            Inline::Image(i) => {
                if let Some(name) = assets.get(*i) {
                    s.push_str(&format!("![](../assets/{name})"));
                }
            }
            Inline::Table(rows) => {
                for (index, row) in rows.iter().enumerate() {
                    s.push('|');
                    for cell in row {
                        s.push(' ');
                        for (index, paragraph) in cell.iter().enumerate() {
                            if index > 0 { s.push(' '); }
                            s.push_str(&markdown(paragraph, assets));
                        }
                        s.push_str(" |");
                    }
                    s.push('\n');
                    if index == 0 {
                        s.push('|');
                        for _ in row { s.push_str(" --- |"); }
                        s.push('\n');
                    }
                }
                s.pop();
            }
            Inline::Break => s.push_str("  \n"),
            Inline::Tab => s.push_str("&#9;"),
        }
    }
    s
}

// Only source-verified, unformatted, explicitly numbered Chinese captions adjacent to a matching
// standalone object are converted. Ambiguous paragraphs remain ordinary text.
fn caption(block: &Block, label: char) -> Option<String> {
    if !block.simple_caption || block.heading_level.is_some() || block.list.is_some() { return None; }
    let mut text = String::new();
    for inline in &block.inlines {
        match inline {
            Inline::Text { text: part, bold: false, italic: false, strike: false } => text.push_str(part),
            Inline::Tab => text.push('\t'),
            _ => return None,
        }
    }
    let rest = text.trim().strip_prefix(label)?.trim_start();
    let number_end = rest.find(char::is_whitespace)?;
    let number = &rest[..number_end];
    let mut parts = number.split(['-', '.']);
    let first = parts.next()?;
    let remaining: Vec<_> = parts.collect();
    let first_valid = !first.is_empty() && (first.chars().all(|c| c.is_ascii_digit())
        || (first.len() == 1 && first.as_bytes()[0].is_ascii_uppercase() && !remaining.is_empty()));
    if !first_valid || remaining.iter().any(|part| part.is_empty() || !part.chars().all(|c| c.is_ascii_digit())) { return None; }
    let tail = &rest[number_end..];
    if !tail.starts_with(char::is_whitespace) { return None; }
    let title = tail.trim();
    (!title.is_empty()).then(|| title.to_owned())
}
fn standalone(block: &Block, image: bool) -> bool {
    block.heading_level.is_none() && block.list.is_none() && match block.inlines.as_slice() {
        [Inline::Image(_)] if image => true,
        [Inline::Table(_)] if !image => true,
        _ => false,
    }
}

// Markdown indentation is measured from the content column of the parent marker,
// not from a fixed number of spaces (ordered markers can be several digits wide).
struct ListFrame {
    id: String,
    level: u8,
    ordered: bool,
    style: Option<&'static str>,
    indent: usize,
    width: usize,
    delimiter: char,
}

#[derive(Default)]
struct ListWriter {
    frames: Vec<ListFrame>,
    // Alternating delimiters prevents adjacent, distinct Word lists from merging.
    last_delimiters: Vec<char>,
    // Numbering belongs to the Word numId, not to a contiguous Markdown list.
    counters: HashMap<(String, u8), u32>,
}

impl ListWriter {
    fn clear(&mut self) {
        self.frames.clear();
        self.last_delimiters.clear();
    }

    fn append(&mut self, body: &mut String, block: &Block, assets: &[String]) {
        let Some(list) = &block.list else {
            self.clear();
            if !body.is_empty() { body.push_str("\n\n"); }
            body.push_str(&markdown(block, assets));
            return;
        };
        let key = (list.id.clone(), list.level);
        let number = self.counters.get(&key).copied().unwrap_or(list.start).min(999_999_999);
        self.counters.retain(|(id, level), _| id != &list.id || *level <= list.level);
        self.counters.insert(key, number.saturating_add(1));
        while self.frames.last().is_some_and(|f| f.level > list.level) {
            self.frames.pop();
        }
        let same = self.frames.last().is_some_and(|f| f.level == list.level
            && f.id == list.id && f.ordered == list.ordered && f.style == list.style);
        if !same {
            if self.frames.last().is_some_and(|f| f.level == list.level) {
                self.frames.pop();
            }
            let depth = self.frames.len();
            let indent = self.frames.last().map_or(0, |f| f.indent + f.width);
            let previous = self.last_delimiters.get(depth).copied();
            let delimiter = if list.ordered {
                if previous == Some('.') { ')' } else { '.' }
            } else if previous == Some('-') { '+' } else { '-' };
            self.last_delimiters.truncate(depth);
            self.last_delimiters.push(delimiter);
            let marker = if list.ordered { format!("{number}{delimiter} ") } else { format!("{delimiter} ") };
            // A non-1 ordered marker cannot interrupt a CommonMark paragraph.
            if !body.is_empty() { body.push_str("\n\n"); }
            if list.ordered {
                if let Some(style) = list.style.filter(|s| *s != "1.") {
                    body.push_str(&format!("{}<!-- writer:list {style} -->\n", " ".repeat(indent)));
                }
            }
            self.frames.push(ListFrame { id: list.id.clone(), level: list.level, ordered: list.ordered, style: list.style, indent, width: marker.len(), delimiter });
            body.push_str(&" ".repeat(indent));
            body.push_str(&marker);
        } else {
            let frame = self.frames.last_mut().unwrap();
            body.push('\n');
            body.push_str(&" ".repeat(frame.indent));
            let marker = if frame.ordered { format!("1{} ", frame.delimiter) }
                else { format!("{} ", frame.delimiter) };
            frame.width = marker.len();
            body.push_str(&marker);
        }
        let frame = self.frames.last().unwrap();
        let content_indent = frame.indent + frame.width;
        body.push_str(&markdown(block, assets).replace('\n', &format!("\n{}", " ".repeat(content_indent))));
    }
}

/// Target is created exclusively; never writes into an existing directory. On failure a
/// partially created project may remain, so no user files are ever removed as rollback.
pub fn import(source: &Path, target: &Path, title: &str) -> Result<(ImportResult, storage::lock::ProjectLock), ImportError> {
    let file = std::fs::File::open(source).map_err(|e| StorageError::Io {
        operation: "open".into(),
        path: source.display().to_string(),
        kind: crate::io_kind::classify(&e),
        message: e.to_string(),
    })?;
    let document = import_docx::convert(file).map_err(|detail| ImportError::InvalidDocx { detail })?;
    std::fs::create_dir(target).map_err(|e| {
        if e.kind() == std::io::ErrorKind::AlreadyExists {
            StorageError::TargetNotEmpty
        } else {
            StorageError::Io {
                operation: "create-dir".into(),
                path: target.display().to_string(),
                kind: crate::io_kind::classify(&e),
                message: e.to_string(),
            }
        }
    })?;
    // Lock before publishing writer.json: another process can open it as soon as it exists.
    let lock = storage::lock::acquire_new(target)?;
    Ok((build(target, title, document)?, lock))
}
fn build(target: &Path, title: &str, doc: ImportedDocument) -> Result<ImportResult, ImportError> {
    let empty = SaveRequest {
        manifest: json!({"format":"writer-project","version":1,"title":title,"chapters":[],"files":{}}),
        contents: BTreeMap::new(),
    };
    storage::create_project(&RealFs, target, &empty)?;
    let mut assets = Vec::new();
    for (i, image) in doc.images.iter().enumerate() {
        assets.push(storage::assets::import_asset_bytes(
            &RealFs,
            target,
            &format!("image-{}.{}", i + 1, image.extension),
            &image.bytes,
        )?);
    }
    let mut chapters = Vec::new();
    let mut path: Vec<usize> = Vec::new();
    let mut levels: Vec<u8> = Vec::new();
    let mut files = BTreeMap::new();
    let mut contents: BTreeMap<String, String> = BTreeMap::new();
    let mut current: Option<String> = None;
    let mut count = 0;
    let stripped_titles = heading_titles(&doc);
    let mut title_index = 0;
    let mut warnings = doc.warnings;
    let mut lists = ListWriter::default();
    let mut blocks = doc.blocks.iter().peekable();
    while let Some(block) = blocks.next() {
        if let Some(level) = block.heading_level {
            lists.clear();
            if block
                .inlines
                .iter()
                .any(|inline| matches!(inline, Inline::Image(_)))
                && !warnings.contains(&"heading_image_unsupported")
            {
                warnings.push("heading_image_unsupported");
            }
            while levels.last().is_some_and(|l| *l >= level) {
                levels.pop();
                path.pop();
            }
            count += 1;
            let id = format!("import-{count}");
            let index = siblings(&chapters, &path).len();
            insert(
                &mut chapters,
                &path,
                Chapter {
                    id: id.clone(),
                    title: stripped_titles.as_ref().map_or_else(|| plain(block), |titles| titles[title_index].clone()),
                    children: vec![],
                },
            );
            title_index += 1;
            path.push(index);
            levels.push(level);
            files.insert(
                id.clone(),
                format!(
                    "ch_{}.md",
                    path.iter()
                        .map(|n| (n + 1).to_string())
                        .collect::<Vec<_>>()
                        .join("_")
                ),
            );
            contents.insert(id.clone(), String::new());
            current = Some(id);
        } else {
            if current.is_none() {
                count += 1;
                let id = format!("import-{count}");
                let index = chapters.len();
                chapters.push(Chapter {
                    id: id.clone(),
                    title: String::new(),
                    children: vec![],
                });
                files.insert(id.clone(), format!("ch_{}.md", index + 1));
                contents.insert(id.clone(), String::new());
                current = Some(id);
            }
            let body = contents.get_mut(current.as_ref().unwrap()).unwrap();
            if standalone(block, true) {
                if let Some(title) = blocks.peek().and_then(|next| caption(next, '图')) {
                    if let [Inline::Image(index)] = block.inlines.as_slice() {
                        if let Some(name) = assets.get(*index) {
                            lists.clear();
                            if !body.is_empty() { body.push_str("\n\n"); }
                            body.push_str(&format!("![{}](../assets/{name})", escape(&title)));
                            blocks.next();
                            continue;
                        }
                    }
                }
            } else if let Some(title) = caption(block, '表') {
                if blocks.peek().is_some_and(|next| standalone(next, false)) {
                    lists.clear();
                    if !body.is_empty() { body.push_str("\n\n"); }
                    body.push_str(&format!("Table: {}\n\n{}", escape(&title), markdown(blocks.next().unwrap(), &assets)));
                    continue;
                }
            }
            lists.append(body, block, &assets);
        }
    }
    let request = SaveRequest {
        manifest: json!({"format":"writer-project","version":1,"title":title,"chapters":chapters,"files":files}),
        contents,
    };
    storage::save_project(&RealFs, target, &request)?;
    Ok(ImportResult {
        project: storage::open_project(&RealFs, target)?,
        warnings,
        warning_details: doc.warning_details,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::import_docx::{Block, Image};
    #[test]
    fn docx_automatic_numbering_and_literal_numbers_preserve_heading_text() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("numbered.docx");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&source).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("word/document.xml", options).unwrap();
        zip.write_all(r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>1 第一章</w:t></w:r></w:p>
          <w:p><w:pPr><w:pStyle w:val="Heading2"/><w:numPr><w:ilvl w:val="1"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>1.1 方法</w:t></w:r></w:p>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:t>2 结论</w:t></w:r></w:p>
        </w:body></w:document>"#.as_bytes()).unwrap();
        zip.start_file("word/numbering.xml", options).unwrap();
        zip.write_all(br#"<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1."/></w:lvl><w:lvl w:ilvl="1"><w:numFmt w:val="decimal"/><w:lvlText w:val="%1.%2"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>"#).unwrap();
        zip.finish().unwrap();
        let root = dir.path().join("project");
        let (result, _lock) = import(&source, &root, "文档").unwrap();
        assert!(result.warnings.contains(&"list_numbering_unsupported"));
        let project = storage::open_project(&RealFs, &root).unwrap();
        assert_eq!(project.manifest["chapters"][0]["title"], "1 第一章");
        assert_eq!(project.manifest["chapters"][0]["children"][0]["title"], "1.1 方法");
        assert_eq!(project.manifest["chapters"][1]["title"], "2 结论");
    }
    #[test]
    fn preamble_does_not_prevent_number_stripping() {
        let block = |level, text: &str| Block {
            heading_level: level, simple_caption: false, list: None,
            inlines: vec![Inline::Text { text: text.into(), bold: false, italic: false, strike: false }],
        };
        let doc = ImportedDocument {
            blocks: vec![block(None, "前言"), block(Some(1), "1 绪论"),
                block(Some(2), "1.1 背景"), block(Some(1), "2 结论")],
            heading_numbering_possible: false, images: vec![], warnings: vec![], warning_details: vec![],
        };
        let dir = tempfile::tempdir().unwrap();
        let result = build(dir.path(), "文档", doc).unwrap();
        let chapters = &result.project.manifest["chapters"];
        assert_eq!(chapters[0]["title"], "");
        assert_eq!(result.project.contents["import-1"], "前言");
        assert_eq!(chapters[1]["title"], "绪论");
        assert_eq!(chapters[1]["children"][0]["title"], "背景");
        assert_eq!(chapters[2]["title"], "结论");
    }

    #[test]
    fn numbered_body_with_preamble_and_lettered_appendices_strips_body_numbers() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("mixed.docx");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&source).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("word/document.xml", options).unwrap();
        write!(zip, "<w:document xmlns:w=\"http://schemas.openxmlformats.org/wordprocessingml/2006/main\"><w:body><w:p><w:r><w:t>前言原文</w:t></w:r></w:p>").unwrap();
        for n in 1..=20 {
            write!(zip, "<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>{n} 正文标题{n}</w:t></w:r></w:p>").unwrap();
        }
        for letter in ['A', 'B', 'C'] {
            write!(zip, "<w:p><w:pPr><w:pStyle w:val=\"Heading1\"/></w:pPr><w:r><w:t>附录 {letter} 原文</w:t></w:r></w:p><w:p><w:r><w:t>附录 {letter} 内容</w:t></w:r></w:p>").unwrap();
        }
        write!(zip, "</w:body></w:document>").unwrap();
        zip.finish().unwrap();
        let (result, _lock) = import(&source, &dir.path().join("project"), "文档").unwrap();
        let chapters = result.project.manifest["chapters"].as_array().unwrap();
        assert_eq!(chapters.len(), 24);
        assert_eq!(chapters[0]["title"], "");
        assert_eq!(result.project.contents["import-1"], "前言原文");
        for n in 1..=20 {
            assert_eq!(chapters[n]["title"], format!("正文标题{n}"));
        }
        for (index, letter) in ['A', 'B', 'C'].into_iter().enumerate() {
            let chapter = &chapters[21 + index];
            assert_eq!(chapter["title"], format!("附录 {letter} 原文"));
            assert_eq!(result.project.contents[chapter["id"].as_str().unwrap()], format!("附录 {letter} 内容"));
        }
    }

    #[test]
    fn lettered_appendix_preserves_its_title_without_blocking_body_stripping() {
        let heading = |text: &str| Block {
            heading_level: Some(1), simple_caption: false, list: None,
            inlines: vec![Inline::Text { text: text.into(), bold: false, italic: false, strike: false }],
        };
        let doc = ImportedDocument {
            blocks: vec![heading("1 绪论"), heading("2 结论"), heading("附录 A 资料")],
            heading_numbering_possible: false, images: vec![], warnings: vec![], warning_details: vec![],
        };
        assert_eq!(heading_titles(&doc).unwrap(), ["绪论", "结论", "附录 A 资料"]);
        let dir = tempfile::tempdir().unwrap();
        let result = build(dir.path(), "文档", doc).unwrap();
        let chapters = &result.project.manifest["chapters"];
        assert_eq!(chapters[0]["title"], "绪论");
        assert_eq!(chapters[1]["title"], "结论");
        assert_eq!(chapters[2]["title"], "附录 A 资料");
    }

    #[test]
    fn continuous_text_headings_are_stripped_only_when_complete() {
        let heading = |level, text: &str| Block {
            heading_level: Some(level), simple_caption: false, list: None,
            inlines: vec![Inline::Text { text: text.into(), bold: false, italic: false, strike: false }],
        };
        let mut doc = ImportedDocument { blocks: vec![heading(1, "1 第一章"), heading(2, "1.1 方法"), heading(1, "2. 结论")],
            heading_numbering_possible: false, images: vec![], warnings: vec![], warning_details: vec![] };
        assert_eq!(heading_titles(&doc).unwrap(), ["第一章", "方法", "结论"]);
        let dir = tempfile::tempdir().unwrap();
        let result = build(dir.path(), "文档", doc).unwrap();
        assert_eq!(result.project.manifest["chapters"][0]["title"], "第一章");
        assert_eq!(result.project.manifest["chapters"][0]["children"][0]["title"], "方法");
        doc = ImportedDocument { blocks: vec![heading(1, "1 第一章"), heading(1, "3 结论")],
            heading_numbering_possible: false, images: vec![], warnings: vec![], warning_details: vec![] };
        assert!(heading_titles(&doc).is_none());
    }

    #[test]
    fn ambiguous_heading_content_prevents_number_stripping() {
        let text = |s: &str| Inline::Text { text: s.into(), bold: false, italic: false, strike: false };
        for extra in [Inline::Break, Inline::Image(0), Inline::Table(vec![])] {
            let doc = ImportedDocument {
                blocks: vec![
                    Block { heading_level: Some(1), simple_caption: false, list: None, inlines: vec![text("1 First"), extra] },
                    Block { heading_level: Some(1), simple_caption: false, list: None, inlines: vec![text("2 Second")] },
                ],
                heading_numbering_possible: false, images: vec![], warnings: vec![], warning_details: vec![],
            };
            assert!(heading_titles(&doc).is_none());
        }
    }

    #[test]
    fn skipped_heading_levels_and_preamble_keep_source_order() {
        let block = |level, text: &str| Block { heading_level: level, simple_caption: false, list: None,
            inlines: vec![Inline::Text { text: text.into(), bold: false, italic: false, strike: false }] };
        let doc = ImportedDocument { blocks: vec![block(None, "前言"), block(Some(2), "A"),
            block(Some(4), "B"), block(Some(3), "C"), block(Some(1), "D")],
            heading_numbering_possible: false, images: vec![], warnings: vec![], warning_details: vec![] };
        let dir = tempfile::tempdir().unwrap();
        let result = build(dir.path(), "文档", doc).unwrap();
        let chapters = &result.project.manifest["chapters"];
        assert_eq!(chapters[0]["title"], "");
        assert_eq!(result.project.contents["import-1"], "前言");
        assert_eq!(chapters[1]["title"], "A");
        assert_eq!(chapters[1]["children"][0]["title"], "B");
        assert_eq!(chapters[1]["children"][1]["title"], "C");
        assert_eq!(chapters[2]["title"], "D");
    }

    #[test]
    fn inherited_heading_numbering_prevents_all_stripping() {
        use std::io::Write;
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("word/document.xml", options).unwrap();
        zip.write_all(br#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>1 First</w:t></w:r></w:p>
          <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>1.1 Child</w:t></w:r></w:p>
        </w:body></w:document>"#).unwrap();
        zip.start_file("word/styles.xml", options).unwrap();
        zip.write_all(br#"<w:styles xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
          <w:style w:type="paragraph" w:styleId="Heading1"><w:basedOn w:val="Base"/></w:style>
          <w:style w:type="paragraph" w:styleId="Base"><w:pPr><w:numPr><w:numId w:val="1"/></w:numPr></w:pPr></w:style>
          <w:style w:type="paragraph" w:styleId="Heading2"/>
        </w:styles>"#).unwrap();
        let doc = import_docx::convert_bytes(&zip.finish().unwrap().into_inner()).unwrap();
        assert!(doc.heading_numbering_possible);
        assert!(heading_titles(&doc).is_none());
        let dir = tempfile::tempdir().unwrap();
        let result = build(dir.path(), "doc", doc).unwrap();
        assert_eq!(result.project.manifest["chapters"][0]["title"], "1 First");
        assert_eq!(result.project.manifest["chapters"][0]["children"][0]["title"], "1.1 Child");
    }
    #[test]
    fn nested_lists_preserve_numbering_and_structure() {
        use crate::import_docx::List;
        use crate::render::markdown::{parse, Block as RenderBlock};
        let item = |id: &str, level, ordered, start, style, text: &str| Block {
            heading_level: None, simple_caption: false,
            list: Some(List { id: id.into(), level, ordered, start, style }),
            inlines: vec![Inline::Text { text: text.into(), bold: false, italic: false, strike: false }],
        };
        let blocks = [item("a", 0, true, 12, Some("I."), "one"),
            item("b", 1, false, 1, None, "nested"),
            item("a", 0, true, 12, Some("I."), "two"),
            item("c", 0, true, 3, Some("a."), "other")];
        let mut body = String::new();
        let mut writer = ListWriter::default();
        for block in &blocks { writer.append(&mut body, block, &[]); }
        let parsed = parse(&body);
        assert_eq!(parsed.len(), 2, "{body}\n{parsed:?}");
        match &parsed[0] {
            RenderBlock::List { ordered, start, numbering, items } => {
                assert!(*ordered);
                assert_eq!(*start, 12);
                assert_eq!(numbering.pattern(), "I.");
                assert_eq!(items.len(), 2);
                assert!(matches!(&items[0][1], RenderBlock::List { ordered: false, .. }), "{body}");
            }
            other => panic!("{other:?}: {body}"),
        }
        assert!(matches!(&parsed[1], RenderBlock::List { start: 3, .. }), "{body}");
    }
    #[test]
    fn interrupted_lists_resume_across_paragraphs_and_chapters() {
        use crate::import_docx::List;
        use crate::render::markdown::{parse, Block as RenderBlock};
        let item = |id: &str, start| Block { heading_level: None, simple_caption: false,
            list: Some(List { id: id.into(), level: 0, ordered: true, start, style: None }),
            inlines: vec![] };
        let paragraph = Block { heading_level: None, simple_caption: false, list: None, inlines: vec![Inline::Text {
            text: "interruption".into(), bold: false, italic: false, strike: false,
        }] };
        let mut writer = ListWriter::default();
        let mut body = String::new();
        writer.append(&mut body, &item("1", 5), &[]);
        writer.append(&mut body, &item("1", 5), &[]);
        writer.append(&mut body, &paragraph, &[]);
        writer.append(&mut body, &item("2", 2), &[]);
        writer.append(&mut body, &item("1", 5), &[]);
        let parsed = parse(&body);
        let starts: Vec<_> = parsed.iter().filter_map(|b| match b {
            RenderBlock::List { start, .. } => Some(*start), _ => None,
        }).collect();
        assert_eq!(starts, vec![5, 2, 7], "{body}");
        writer.clear(); // heading creates a new chapter, not a new Word numbering instance
        let mut next_chapter = String::new();
        writer.append(&mut next_chapter, &item("1", 5), &[]);
        assert!(matches!(&parse(&next_chapter)[0], RenderBlock::List { start: 8, .. }), "{next_chapter}");
    }
    #[test]
    fn markdown_text_preserves_literal_parser_semantics() {
        use pulldown_cmark::{Event, Options, Parser};
        let text = "  &amp; &#65; ^^^^ $x$ <tag>  ";
        let block = Block {
            heading_level: None, simple_caption: false,
            inlines: vec![Inline::Text { text: text.into(), bold: false, italic: false, strike: false }, Inline::Tab, Inline::Text { text: "end".into(), bold: false, italic: false, strike: false }],
            list: None,
        };
        let source = markdown(&block, &[]);
        let events: Vec<_> = Parser::new_ext(&source, Options::all()).collect();
        let parsed: String = events.iter().filter_map(|event| match event {
            Event::Text(value) => Some(value.as_ref()),
            _ => None,
        }).collect();
        assert_eq!(parsed, format!("{text}\tend"), "{source:?}: {events:?}");
        assert!(!events.iter().any(|event| matches!(event, Event::InlineMath(_) | Event::DisplayMath(_) | Event::Html(_) | Event::InlineHtml(_))));
    }
    #[test]
    fn docx_formatted_punctuation_between_words() {
        use std::io::Write;
        use pulldown_cmark::{Event, Options, Parser, Tag};
        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        zip.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>前</w:t></w:r><w:r><w:rPr><w:b/></w:rPr><w:t>“内容”</w:t></w:r><w:r><w:t>后</w:t></w:r></w:p></w:body></w:document>"#.as_bytes()).unwrap();
        let doc = import_docx::convert_bytes(&zip.finish().unwrap().into_inner()).unwrap();
        let source = markdown(&doc.blocks[0], &[]);
        let events: Vec<_> = Parser::new_ext(&source, Options::all()).collect();
        let text: String = events.iter().filter_map(|e| match e { Event::Text(t) => Some(t.as_ref()), _ => None }).collect();
        assert_eq!(source, "&#21069;**&#8220;&#20869;&#23481;&#8221;**&#21518;");
        assert_eq!(text, "前“内容”后", "{source:?}: {events:?}");
        assert!(events.iter().any(|e| matches!(e, Event::Start(Tag::Strong))), "{source:?}: {events:?}");
    }
    #[test]
    fn docx_list_bold_label_followed_by_chinese_text() {
        use std::io::Write;
        use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};

        let mut zip = zip::ZipWriter::new(std::io::Cursor::new(Vec::new()));
        let opt = zip::write::SimpleFileOptions::default();
        zip.start_file("word/document.xml", opt).unwrap();
        zip.write_all(r#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>加料顺序：</w:t></w:r><w:r><w:t>先加入水</w:t></w:r></w:p></w:body></w:document>"#.as_bytes()).unwrap();
        zip.start_file("word/numbering.xml", opt).unwrap();
        zip.write_all(r#"<w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>"#.as_bytes()).unwrap();
        let doc = import_docx::convert_bytes(&zip.finish().unwrap().into_inner()).unwrap();
        assert!(doc.warnings.is_empty(), "{:?}", doc.warnings);
        let mut source = String::new();
        ListWriter::default().append(&mut source, &doc.blocks[0], &[]);
        assert_eq!(source.trim_end(), "- **&#21152;&#26009;&#39034;&#24207;&#65306;**&#20808;&#21152;&#20837;&#27700;");
        let events: Vec<_> = Parser::new_ext(&source, Options::all()).collect();
        let mut strong = false;
        let mut parts = Vec::new();
        for event in &events {
            match event {
                Event::Start(Tag::Strong) => strong = true,
                Event::End(TagEnd::Strong) => strong = false,
                Event::Text(value) => parts.push((value.to_string(), strong)),
                _ => {}
            }
        }
        let full: String = parts.iter().map(|(text, _)| text.as_str()).collect();
        let bold: String = parts.iter().filter(|(_, strong)| *strong).map(|(text, _)| text.as_str()).collect();
        let normal: String = parts.iter().filter(|(_, strong)| !*strong).map(|(text, _)| text.as_str()).collect();
        assert!(events.iter().any(|e| matches!(e, Event::Start(Tag::Item))), "{events:?}");
        assert_eq!(full, "加料顺序：先加入水");
        assert_eq!(bold, "加料顺序：");
        assert_eq!(normal, "先加入水");
    }
    #[test]
    fn markdown_preserves_formatted_text_and_breaks() {
        use pulldown_cmark::{Event, Options, Parser, Tag, TagEnd};
        let block = Block {
            heading_level: None, simple_caption: false,
            inlines: vec![
                Inline::Text { text: " bold &amp; ".into(), bold: true, italic: false, strike: false },
                Inline::Break,
                Inline::Text { text: "a\tb\nc".into(), bold: false, italic: false, strike: false },
            ],
            list: None,
        };
        let source = markdown(&block, &[]);
        let events: Vec<_> = Parser::new_ext(&source, Options::all()).collect();
        assert!(events.iter().any(|e| matches!(e, Event::Start(Tag::Strong))), "{source:?}: {events:?}");
        assert!(events.iter().any(|e| matches!(e, Event::End(TagEnd::Strong))));
        assert!(events.iter().any(|e| matches!(e, Event::HardBreak)));
        let parsed: String = events.iter().filter_map(|e| match e {
            Event::Text(value) => Some(value.as_ref()),
            _ => None,
        }).collect();
        assert_eq!(parsed, " bold &amp; a\tb\nc");
    }
    #[test]
    fn table_cell_paragraphs_are_separated() {
        let paragraph = |text: &str| Block { heading_level: None, simple_caption: false, list: None, inlines: vec![Inline::Text { text: text.into(), bold: false, italic: false, strike: false }] };
        let table = Block { heading_level: None, simple_caption: false, list: None, inlines: vec![Inline::Table(vec![vec![vec![paragraph("one"), paragraph("two")]]])] };
        assert_eq!(markdown(&table, &[]), "| one two |\n| --- |");
    }
    #[test]
    fn adjacent_numbered_captions_are_converted_conservatively() {
        use std::io::{Cursor, Write};
        let table = "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>数据</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";
        let paragraph = |props: &str, content: &str| format!("<w:p><w:pPr>{props}</w:pPr>{content}</w:p>");
        let run = |text: &str| format!("<w:r><w:t>{text}</w:t></w:r>");
        let style = "<w:pStyle w:val='Caption'/>";
        let body = format!("{}{}{}{}{}{}{}{}", 
            paragraph(style, &run("表 2.3 样本")), table,
            paragraph("", &run("表 3 普通段落")), table,
            paragraph(style, "<w:hyperlink><w:r><w:t>表 4 链接</w:t></w:r></w:hyperlink>"), table,
            paragraph(style, "<w:fldSimple w:instr='SEQ Table'><w:r><w:t>表 5 域</w:t></w:r></w:fldSimple>"), table);
        let xml = format!("<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:body>{body}</w:body></w:document>");
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(xml.as_bytes()).unwrap();
        let doc = crate::import_docx::convert_bytes(&zip.finish().unwrap().into_inner()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let result = build(dir.path(), "文档", doc).unwrap();
        let output = &result.project.contents["import-1"];
        assert!(output.starts_with("Table: 样本\n\n| 数据 |"), "{output}");
        for text in ["表 3 普通段落", "表 4 链接", "表 5 域"] { assert!(output.contains(text), "{output}"); }
    }
    #[test]
    fn directly_formatted_captions_require_signals_and_adjacency() {
        use std::io::{Cursor, Write};
        let table = "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>数据</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";
        let paragraph = |props: &str, text: &str| format!("<w:p><w:pPr>{props}</w:pPr><w:r><w:rPr><w:rFonts w:eastAsia='黑体'/><w:sz w:val='21'/></w:rPr><w:t>{text}</w:t></w:r></w:p>");
        let direct = "<w:keepNext/><w:spacing w:after='60' w:before='120'/><w:jc w:val='center'/>";
        let body = format!("{}{table}{}{table}{}{table}{}{table}{}{table}",
            paragraph(direct, "表 3-1  样本"), paragraph(direct, "表 B-1  附录"),
            paragraph("<w:jc w:val='center'/>", "表 2 普通文字"),
            paragraph(direct, "表 B 错误编号"), paragraph(direct, "表 3-1x 错误编号"));
        let xml = format!("<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:body>{body}</w:body></w:document>");
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(xml.as_bytes()).unwrap();
        let doc = crate::import_docx::convert_bytes(&zip.finish().unwrap().into_inner()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let result = build(dir.path(), "文档", doc).unwrap();
        let output = &result.project.contents["import-1"];
        assert!(output.contains("Table: 样本\n\n| 数据 |"), "{output}");
        assert!(output.contains("Table: 附录\n\n| 数据 |"), "{output}");
        for text in ["表 2 普通文字", "表 B 错误编号", "表 3\\-1x 错误编号"] { assert!(output.contains(text), "{output}"); }
    }
    #[test]
    fn localized_caption_styles_and_tabs_preserve_ordinary_references() {
        use std::io::{Cursor, Write};
        let table = "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>数据</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";
        let paragraph = |style: &str, text: &str| format!("<w:p><w:pPr><w:pStyle w:val='{style}'/></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>");
        let body = format!("<w:p><w:pPr><w:pStyle w:val='42'/></w:pPr><w:r><w:t>表 2-1</w:t><w:tab/><w:t>样本</w:t></w:r></w:p>{table}{}{table}{}{table}{}{table}",
            paragraph("normal", "表 3 显示了样本"), paragraph("derived", "表 4 数据"), paragraph("42", "如表 5 所示"));
        let xml = format!("<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:body>{body}</w:body></w:document>");
        let styles = "<w:styles xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:style w:type='paragraph' w:styleId='42'><w:name w:val='题注'/></w:style><w:style w:type='paragraph' w:styleId='derived'><w:basedOn w:val='42'/></w:style><w:style w:type='paragraph' w:styleId='normal'><w:name w:val='Normal'/></w:style></w:styles>";
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (path, data) in [("word/document.xml", xml.as_str()), ("word/styles.xml", styles)] {
            zip.start_file(path, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(data.as_bytes()).unwrap();
        }
        let doc = crate::import_docx::convert_bytes(&zip.finish().unwrap().into_inner()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let result = build(dir.path(), "文档", doc).unwrap();
        let output = &result.project.contents["import-1"];
        assert!(output.starts_with("Table: 样本\n\n| 数据 |"), "{output}");
        assert!(output.contains("表 3 显示了样本\n\n| 数据 |"), "{output}");
        assert!(output.contains("Table: 数据\n\n| 数据 |"), "{output}");
        assert!(output.contains("如表 5 所示\n\n| 数据 |"), "{output}");
    }
    #[test]
    fn simple_seq_caption_uses_cached_number_without_duplicating_it() {
        use std::io::{Cursor, Write};
        let xml = r#"<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:body>
          <w:p><w:pPr><w:pStyle w:val='Caption'/></w:pPr><w:r><w:t>表 </w:t></w:r><w:fldSimple w:instr=' SEQ Table \* ARABIC '><w:r><w:t>3</w:t></w:r></w:fldSimple><w:r><w:t> 样本</w:t></w:r></w:p>
          <w:tbl><w:tr><w:tc><w:p><w:r><w:t>数据</w:t></w:r></w:p></w:tc></w:tr></w:tbl>
        </w:body></w:document>"#;
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        zip.start_file("word/document.xml", zip::write::SimpleFileOptions::default()).unwrap();
        zip.write_all(xml.as_bytes()).unwrap();
        let doc = crate::import_docx::convert_bytes(&zip.finish().unwrap().into_inner()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let result = build(dir.path(), "文档", doc).unwrap();
        assert!(result.project.contents["import-1"].starts_with("Table: 样本\n\n| 数据 |"));
    }
    #[test]
    fn docx_images_and_captions_require_source_adjacency() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("input.docx");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&source).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        let image = "<w:p><w:r><w:drawing><a:blip r:embed='r1'/></w:drawing></w:r></w:p>";
        let caption = |text: &str| format!("<w:p><w:pPr><w:pStyle w:val='Caption'/></w:pPr><w:r><w:t>{text}</w:t></w:r></w:p>");
        let table = "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>数据</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";
        let body = format!("{image}{}{image}<w:customXml/>{}{}<w:customXml/>{table}{}{table}",
            caption("图 1 实验装置"), caption("图 2 不相邻"), caption("表 3 不相邻"), caption("表 4 样本"));
        let xml = format!("<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main' xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships' xmlns:a='http://schemas.openxmlformats.org/drawingml/2006/main'><w:body>{body}</w:body></w:document>");
        zip.start_file("word/document.xml", options).unwrap();
        zip.write_all(xml.as_bytes()).unwrap();
        zip.start_file("word/_rels/document.xml.rels", options).unwrap();
        zip.write_all(br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/p.png"/></Relationships>"#).unwrap();
        zip.start_file("word/media/p.png", options).unwrap();
        let bytes = b"\x89PNG\r\n\x1a\nimage";
        zip.write_all(bytes).unwrap();
        zip.finish().unwrap();
        let root = dir.path().join("project");
        let (result, _lock) = import(&source, &root, "文档").unwrap();
        let output = &result.project.contents["import-1"];
        assert!(output.contains("![实验装置](../assets/image-1.png)"), "{output}");
        assert!(output.contains("![](../assets/image-1.png)\n\n图 2 不相邻"), "{output}");
        assert!(output.contains("表 3 不相邻\n\n| 数据 |"), "{output}");
        assert!(output.contains("Table: 样本\n\n| 数据 |"), "{output}");
        assert!(result.warnings.contains(&"body_content_unsupported"));
        assert_eq!(std::fs::read(root.join("assets/image-1.png")).unwrap(), bytes);
        assert_eq!(storage::open_project(&RealFs, &root).unwrap().contents["import-1"], *output);
    }
    #[test]
    fn bookmarked_captions_require_complete_local_pairs() {
        use std::io::{Cursor, Write};
        let image = "<w:p><w:r><w:drawing><a:blip r:embed='r1'/></w:drawing></w:r></w:p>";
        let table = "<w:tbl><w:tr><w:tc><w:p><w:r><w:t>数据</w:t></w:r></w:p></w:tc></w:tr></w:tbl>";
        let caption = |markers: &str, text: &str, end: &str| format!("<w:p><w:pPr><w:pStyle w:val='Caption'/></w:pPr>{markers}<w:r><w:t>{text}</w:t></w:r>{end}</w:p>");
        let start = "<w:bookmarkStart w:id='1' w:name='_WriterElement1'/>";
        let end = "<w:bookmarkEnd w:id='1'/>";
        let body = format!("{image}{}{}{table}{}{table}{}{table}{}{table}",
            caption(start, "图 1-1　装置", end), caption(start, "表 1-1　样本", end),
            caption(start, "表 2 未闭合", ""), caption("", "表 3 未开始", end),
            caption(start, "表 4 不匹配", "<w:bookmarkEnd w:id='2'/>"));
        let xml = format!("<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main' xmlns:r='http://schemas.openxmlformats.org/officeDocument/2006/relationships' xmlns:a='http://schemas.openxmlformats.org/drawingml/2006/main'><w:body>{body}</w:body></w:document>");
        let rels = r#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/p.png"/></Relationships>"#;
        let mut zip = zip::ZipWriter::new(Cursor::new(Vec::new()));
        for (path, data) in [("word/document.xml", xml.as_bytes()), ("word/_rels/document.xml.rels", rels.as_bytes()), ("word/media/p.png", b"\x89PNG\r\n\x1a\nimage".as_slice())] {
            zip.start_file(path, zip::write::SimpleFileOptions::default()).unwrap();
            zip.write_all(data).unwrap();
        }
        let doc = crate::import_docx::convert_bytes(&zip.finish().unwrap().into_inner()).unwrap();
        let dir = tempfile::tempdir().unwrap();
        let result = build(dir.path(), "文档", doc).unwrap();
        let output = &result.project.contents["import-1"];
        assert!(output.contains("![装置](../assets/image-1.png)"), "{output}");
        assert!(output.contains("Table: 样本\n\n| 数据 |"), "{output}");
        for text in ["表 2 未闭合", "表 3 未开始", "表 4 不匹配"] { assert!(output.contains(text), "{output}"); }
    }
    #[test]
    fn creates_tree_assets_and_warnings() {
        let dir = tempfile::tempdir().unwrap();
        let root = dir.path().join("project");
        std::fs::create_dir(&root).unwrap();
        let txt = |s: &str| Inline::Text {
            text: s.into(),
            bold: false,
            italic: false,
            strike: false,
        };
        let doc = ImportedDocument {
            heading_numbering_possible: false,
            blocks: vec![
                Block {
                    heading_level: Some(2), simple_caption: false,
                    inlines: vec![txt("标题")],
                    list: None,
                },
                Block {
                    heading_level: None, simple_caption: false,
                    inlines: vec![txt("a * b"), Inline::Image(0)],
                    list: None,
                },
                Block {
                    heading_level: Some(4), simple_caption: false,
                    inlines: vec![txt("子")],
                    list: None,
                },
            ],
            images: vec![Image {
                extension: "png",
                bytes: b"\x89PNG\r\n\x1a\nfoo".to_vec(),
            }],
            warnings: vec!["table_unsupported"],
            warning_details: vec![],
        };
        let result = build(&root, "文档", doc).unwrap();
        assert_eq!(result.warnings, vec!["table_unsupported"]);
        assert_eq!(result.project.manifest["files"]["import-2"], "ch_1_1.md");
        assert_eq!(
            result.project.contents["import-1"],
            "a \\* b![](../assets/image-1.png)"
        );
        assert!(root.join("assets/image-1.png").exists());
    }
    #[test]
    fn imports_docx_then_reopens_and_saves_renumbered_project() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("输入.docx");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&source).unwrap());
        let options = zip::write::SimpleFileOptions::default();
        zip.start_file("word/document.xml", options).unwrap();
        zip.write_all(br#"<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main"><w:body>
          <w:p><w:r><w:t>Preface</w:t></w:r></w:p>
          <w:p><w:pPr><w:pStyle w:val="Heading1"/></w:pPr><w:r><w:t>Chapter</w:t></w:r></w:p>
          <w:p><w:r><w:t>Picture </w:t><w:drawing><a:blip r:embed="r1"/></w:drawing></w:r></w:p>
          <w:tbl><w:tr><w:tc><w:p><w:r><w:t>A|B</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:rPr><w:b/></w:rPr><w:t>Head</w:t></w:r></w:p></w:tc></w:tr><w:tr><w:tc><w:p><w:r><w:t>Data</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:drawing><a:blip r:embed="r1"/></w:drawing></w:r></w:p></w:tc></w:tr></w:tbl>
          <w:p><w:pPr><w:pStyle w:val="Heading2"/></w:pPr><w:r><w:t>Child</w:t></w:r></w:p>
          <w:p><w:r><w:t>Body</w:t></w:r></w:p>
        </w:body></w:document>"#).unwrap();
        zip.start_file("word/_rels/document.xml.rels", options)
            .unwrap();
        zip.write_all(br#"<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="r1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/p.png"/></Relationships>"#).unwrap();
        zip.start_file("word/media/p.png", options).unwrap();
        let image = b"\x89PNG\r\n\x1a\nimage";
        zip.write_all(image).unwrap();
        zip.finish().unwrap();

        let root = dir.path().join("项目");
        let (imported, lock) = import(&source, &root, "文档").unwrap();
        assert!(matches!(storage::lock::acquire(&root), Err(StorageError::ProjectLocked)));
        assert_eq!(imported.warnings, vec!["table_header_assumed"]);
        let serialized = serde_json::to_value(&imported).unwrap();
        assert_eq!(serialized["warningDetails"], json!([{
            "code": "table_header_assumed", "location": {"block": 4, "tableIndex": 1}, "contentType": "表格", "nearbyText": "A|BHeadData"
        }]));
        let project = storage::open_project(&RealFs, &root).unwrap();
        assert_eq!(project, imported.project);
        assert_eq!(project.manifest["format"], "writer-project");
        assert_eq!(project.manifest["version"], 1);
        assert_eq!(
            project.manifest["chapters"][1]["children"][0]["title"],
            "Child"
        );
        assert_eq!(project.manifest["files"]["import-2"], "ch_2.md");
        assert_eq!(project.manifest["files"]["import-3"], "ch_2_1.md");
        let body = &project.contents["import-2"];
        assert_eq!(body, "Picture&#32;![](../assets/image-1.png)\n\n| A\\|B | **Head** |\n| --- | --- |\n| Data | ![](../assets/image-1.png) |");
        assert_eq!(
            std::fs::read(root.join("assets/image-1.png")).unwrap(),
            image
        );
        assert_eq!(
            std::fs::read_to_string(root.join("content/ch_2.md")).unwrap(),
            *body
        );

        // A normal later save can renumber chapters without supplying unchanged bodies.
        let mut manifest = project.manifest.clone();
        manifest["chapters"].as_array_mut().unwrap().remove(0);
        manifest["files"]
            .as_object_mut()
            .unwrap()
            .remove("import-1");
        manifest["files"]["import-2"] = json!("ch_1.md");
        manifest["files"]["import-3"] = json!("ch_1_1.md");
        storage::save_project(
            &RealFs,
            &root,
            &SaveRequest {
                manifest,
                contents: BTreeMap::new(),
            },
        )
        .unwrap();
        let reopened = storage::open_project(&RealFs, &root).unwrap();
        assert_eq!(reopened.contents["import-2"], *body);
        assert_eq!(reopened.contents["import-3"], "Body");
        assert!(reopened.orphan_files.is_empty());
        assert!(!root.join("content/ch_2.md").exists());
        assert_eq!(
            std::fs::read_to_string(root.join("content/ch_1.md")).unwrap(),
            *body
        );
        drop(lock);
        assert!(storage::lock::acquire(&root).is_ok());
    }
    #[test]
    fn refuses_existing_target_without_touching_it() {
        use std::io::Write;
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("input.docx");
        let mut zip = zip::ZipWriter::new(std::fs::File::create(&source).unwrap());
        zip.start_file(
            "word/document.xml",
            zip::write::SimpleFileOptions::default(),
        )
        .unwrap();
        zip.write_all(b"<w:document xmlns:w='http://schemas.openxmlformats.org/wordprocessingml/2006/main'><w:body/></w:document>").unwrap();
        zip.finish().unwrap();
        let target = dir.path().join("existing");
        std::fs::create_dir(&target).unwrap();
        std::fs::write(target.join("keep"), "data").unwrap();
        assert!(matches!(
            import(&source, &target, "x"),
            Err(ImportError::Storage {
                error: StorageError::TargetNotEmpty
            })
        ));
        assert_eq!(
            std::fs::read_to_string(target.join("keep")).unwrap(),
            "data"
        );
    }
    #[test]
    fn missing_source_is_storage_error_and_does_not_create_destination() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("missing.docx");
        let target = dir.path().join("new");
        assert!(matches!(import(&source, &target, "x"), Err(ImportError::Storage { error: StorageError::Io { .. } })));
        assert!(!target.exists());
    }

    #[test]
    fn failed_build_releases_project_lock() {
        let dir = tempfile::tempdir().unwrap();
        let target = dir.path().join("new");
        std::fs::create_dir(&target).unwrap();
        let lock = storage::lock::acquire_new(&target).unwrap();
        // An unsupported image forces failure after the empty manifest has been published.
        let doc = ImportedDocument { blocks: vec![], heading_numbering_possible: false, images: vec![Image { extension: "png", bytes: b"bad".to_vec() }], warnings: vec![], warning_details: vec![] };
        assert!(build(&target, "x", doc).is_err());
        drop(lock);
        assert!(storage::lock::acquire(&target).is_ok());
    }

    #[test]
    fn invalid_source_does_not_create_destination() {
        let dir = tempfile::tempdir().unwrap();
        let source = dir.path().join("bad.docx");
        std::fs::write(&source, b"bad").unwrap();
        let target = dir.path().join("new");
        assert!(import(&source, &target, "x").is_err());
        assert!(!target.exists());
    }
}
