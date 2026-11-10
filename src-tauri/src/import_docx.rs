//! Loss-aware DOCX conversion. This module does not write project files.
//! Paragraphs remain in document order; callers decide how headings become chapters
//! and how image indices become project asset paths.
use std::collections::{HashMap, HashSet};
use std::io::{Cursor, Read};
use std::path::Path;

use roxmltree::{Document, Node};
use zip::ZipArchive;

const W: &str = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const R: &str = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
const A: &str = "http://schemas.openxmlformats.org/drawingml/2006/main";
const REL: &str = "http://schemas.openxmlformats.org/package/2006/relationships";
const MAX_XML: u64 = 16 * 1024 * 1024;
const MAX_IMAGE: u64 = 50 * 1024 * 1024;
const MAX_TOTAL: u64 = 200 * 1024 * 1024;

#[derive(Debug, PartialEq, Eq)]
pub struct ImportedDocument {
    pub blocks: Vec<Block>,
    /// A heading may have Word automatic numbering, including style inheritance.
    pub heading_numbering_possible: bool,
    pub images: Vec<Image>,
    /// Stable machine-readable warning codes, deduplicated in encounter order.
    pub warnings: Vec<&'static str>,
    pub warning_details: Vec<WarningDetail>,
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarningDetail {
    pub code: &'static str,
    pub location: WarningLocation,
    pub content_type: &'static str,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub nearby_text: Option<String>,
}

#[derive(Debug, PartialEq, Eq, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WarningLocation {
    pub block: usize,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub table_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub row: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cell: Option<usize>,
}
#[derive(Debug, PartialEq, Eq)]
pub struct Block {
    /// Word outline level, 1–9. None means ordinary body text.
    pub heading_level: Option<u8>,
    /// Source XML proves this is an explicit, simple Caption paragraph.
    pub simple_caption: bool,
    pub inlines: Vec<Inline>,
    pub list: Option<List>,
}
#[derive(Debug, PartialEq, Eq)]
pub struct List {
    pub id: String,
    pub level: u8,
    pub ordered: bool,
    pub start: u32,
    pub style: Option<&'static str>,
}
#[derive(Debug, PartialEq, Eq)]
pub enum Inline {
    Text {
        text: String,
        bold: bool,
        italic: bool,
        strike: bool,
    },
    Image(usize),
    Break,
    Tab,
    /// Rectangular table rows; each cell contains its paragraphs.
    Table(Vec<Vec<Vec<Block>>>),
}
#[derive(Debug, PartialEq, Eq)]
pub struct Image {
    pub extension: &'static str,
    pub bytes: Vec<u8>,
}

#[derive(Default)]
struct Field {
    instruction: String,
    result: bool,
    closed: bool,
}

fn common_field(instruction: &str) -> bool {
    instruction.split_whitespace().next().is_some_and(|name| {
        ["PAGE", "NUMPAGES", "SECTION", "SECTIONPAGES", "REF", "PAGEREF", "NOTEREF", "SEQ", "TOC", "HYPERLINK", "DATE", "TIME", "AUTHOR", "TITLE", "SUBJECT", "FILENAME", "DOCPROPERTY"].iter().any(|known| name.eq_ignore_ascii_case(known))
    })
}

fn warn(out: &mut ImportedDocument, code: &'static str) {
    if !out.warnings.contains(&code) {
        out.warnings.push(code);
    }
}
// Locations refer to 1-based source body elements (excluding section properties),
// not generated chapters or page numbers, which can change during import.
fn warn_at(out: &mut ImportedDocument, code: &'static str, node: Node<'_, '_>) {
    warn(out, code);
    let Some(block) = node.ancestors().find(|n| n.parent().is_some_and(|p| is(p, W, "body"))) else { return };
    let index = block.prev_siblings().filter(|n| n.is_element() && !is(*n, W, "sectPr")).count();
    let row = node.ancestors().find(|n| is(*n, W, "tr"));
    let cell = node.ancestors().find(|n| is(*n, W, "tc"));
    let location = WarningLocation {
        block: index,
        table_index: is(block, W, "tbl").then(|| block.prev_siblings().filter(|n| is(*n, W, "tbl")).count()),
        row: row.map(|n| n.prev_siblings().filter(|x| is(*x, W, "tr")).count()),
        cell: cell.map(|n| n.prev_siblings().filter(|x| is(*x, W, "tc")).count()),
    };
    let content_type = match code {
        c if c.starts_with("table_") => "表格",
        c if c.starts_with("image_") || c == "heading_image_unsupported" => "图片",
        "list_numbering_unsupported" => "列表编号",
        "field_unsupported" => "域",
        "hyperlink_target_unsupported" => "超链接",
        "drawing_unsupported" => "绘图",
        "note_unsupported" => "脚注或尾注",
        "math_unsupported" => "公式",
        _ => "正文内容",
    };
    // Keep the closest table context ahead of unrelated body blocks.
    let paragraph = node.ancestors().find(|n| is(*n, W, "p"));
    let snippet = |context: Node<'_, '_>| {
        let text = context.descendants().filter(|n| is(*n, W, "t"))
            .filter_map(|n| n.text()).collect::<String>();
        let normalized = text.split_whitespace().collect::<Vec<_>>().join(" ");
        let text: String = normalized.chars().take(80).collect();
        (!text.is_empty()).then_some(text)
    };
    let nearby_text = paragraph.and_then(snippet)
        .or_else(|| cell.and_then(snippet))
        .or_else(|| snippet(block))
        .or_else(|| {
            let mut before = block.prev_siblings().skip(1).filter(|n| n.is_element() && !is(*n, W, "sectPr"));
            let mut after = block.next_siblings().skip(1).filter(|n| n.is_element() && !is(*n, W, "sectPr"));
            loop {
                match (before.next(), after.next()) {
                    (None, None) => break None,
                    (left, right) => {
                        if let Some(text) = left.and_then(snippet).or_else(|| right.and_then(snippet)) {
                            break Some(text);
                        }
                    }
                }
            }
        });
    let detail = WarningDetail { code, location, content_type, nearby_text };
    if !out.warning_details.contains(&detail) { out.warning_details.push(detail); }
}
fn is(n: Node<'_, '_>, ns: &str, name: &str) -> bool {
    n.has_tag_name((ns, name))
}
fn child<'a, 'b>(n: Node<'a, 'b>, ns: &str, name: &str) -> Option<Node<'a, 'b>> {
    n.children().find(|c| is(*c, ns, name))
}
fn val<'a>(n: Node<'a, '_>) -> Option<&'a str> {
    n.attribute((W, "val"))
}
fn enabled(n: Node<'_, '_>, name: &str) -> bool {
    child(n, W, name).is_some_and(|x| !matches!(val(x), Some("0" | "false" | "off")))
}
fn read_part<Rd: Read + std::io::Seek>(
    zip: &mut ZipArchive<Rd>,
    name: &str,
    limit: u64,
) -> Result<Vec<u8>, String> {
    let mut f = zip.by_name(name).map_err(|e| format!("{name}: {e}"))?;
    if f.size() > limit {
        return Err(format!("{name}: size limit exceeded"));
    }
    let mut data = Vec::new();
    f.by_ref()
        .take(limit + 1)
        .read_to_end(&mut data)
        .map_err(|e| e.to_string())?;
    if data.len() as u64 > limit {
        return Err(format!("{name}: size limit exceeded"));
    }
    Ok(data)
}
fn xml(bytes: &[u8]) -> Result<Document<'_>, String> {
    let s = std::str::from_utf8(bytes).map_err(|e| e.to_string())?;
    Document::parse(s).map_err(|e| e.to_string())
}
/// Read a DOCX from disk. No filesystem writes or external resource fetches occur.
pub fn read_docx(path: &Path) -> Result<ImportedDocument, String> {
    let f = std::fs::File::open(path).map_err(|e| e.to_string())?;
    convert(f)
}
/// Convert a DOCX byte slice; malformed archives or required XML return an error.
pub fn convert_bytes(bytes: &[u8]) -> Result<ImportedDocument, String> {
    convert(Cursor::new(bytes))
}

pub(crate) fn convert<Rd: Read + std::io::Seek>(reader: Rd) -> Result<ImportedDocument, String> {
    let mut zip = ZipArchive::new(reader).map_err(|e| e.to_string())?;
    let mut total = 0u64;
    if zip.len() > 10_000 {
        return Err("archive size limit exceeded".into());
    }
    for i in 0..zip.len() {
        let f = zip.by_index(i).map_err(|e| e.to_string())?;
        total = total.checked_add(f.size()).ok_or("archive size overflow")?;
        if total > MAX_TOTAL {
            return Err("archive size limit exceeded".into());
        }
    }
    let main = read_part(&mut zip, "word/document.xml", MAX_XML)?;
    let doc = xml(&main)?;
    let body = doc
        .descendants()
        .find(|n| is(*n, W, "body"))
        .ok_or("missing document body")?;
    let mut out = ImportedDocument {
        blocks: vec![],
        heading_numbering_possible: false,
        images: vec![],
        warnings: vec![],
        warning_details: vec![],
    };
    let rel_name = "word/_rels/document.xml.rels";
    // Missing relationships are valid; corrupt or oversized parts are not equivalent
    // to an absent part and must not silently discard embedded content.
    let rel_data = match zip.by_name(rel_name) {
        Ok(_) => true,
        Err(zip::result::ZipError::FileNotFound) => false,
        Err(e) => return Err(format!("{rel_name}: {e}")),
    };
    let rel_data = if rel_data {
        Some(read_part(&mut zip, rel_name, MAX_XML)?)
    } else {
        None
    };
    let mut rels = HashMap::new();
    if let Some(ref b) = rel_data {
        let d = xml(b)?;
        for n in d.descendants().filter(|n| is(*n, REL, "Relationship")) {
            if let (Some(id), Some(target)) = (n.attribute("Id"), n.attribute("Target")) {
                if n.attribute("TargetMode") != Some("External")
                    && n.attribute("Type").is_some_and(|t| t.ends_with("/image"))
                {
                    rels.insert(id.to_owned(), target.to_owned());
                }
            }
        }
    }
    let has_numbering = match zip.by_name("word/numbering.xml") {
        Ok(_) => true,
        Err(zip::result::ZipError::FileNotFound) => false,
        Err(e) => return Err(format!("word/numbering.xml: {e}")),
    };
    let numbering_data = if has_numbering {
        Some(read_part(&mut zip, "word/numbering.xml", MAX_XML)?)
    } else { None };
    let numbering_doc = numbering_data.as_deref().map(xml).transpose()?;
    let styles_data = match zip.by_name("word/styles.xml") {
        Ok(_) => true,
        Err(zip::result::ZipError::FileNotFound) => false,
        Err(e) => return Err(format!("word/styles.xml: {e}")),
    };
    let styles_data = if styles_data {
        Some(read_part(&mut zip, "word/styles.xml", MAX_XML)?)
    } else { None };
    let styles_doc = styles_data.as_deref().map(xml).transpose()?;
    for p in body.descendants().filter(|n| is(*n, W, "p")) {
        let props = child(p, W, "pPr");
        let num = props.and_then(|p| child(p, W, "numPr"));
        if !p.ancestors().any(|n| is(n, W, "tbl")) && heading_level(p, styles_doc.as_ref()).is_some() && (num.is_some_and(|n| {
            child(n, W, "numId").and_then(val) != Some("0")
        }) || styles_doc.as_ref().is_some_and(|styles| heading_style_may_number(p, styles))) {
            out.heading_numbering_possible = true;
        }
        let id = num.and_then(|n| child(n, W, "numId")).and_then(val);
        let level = num.and_then(|n| child(n, W, "ilvl")).and_then(val)
            .and_then(|v| v.parse::<u8>().ok()).unwrap_or(0);
        if styles_doc.as_ref().is_some_and(|styles| inherits_list(p, styles))
            || id.is_some_and(|id| id != "0" && numbering_doc.as_ref().and_then(|d| list_definition(d, id, level)).is_none()) {
            warn_at(&mut out, "list_numbering_unsupported", p);
        }
    }
    // Unterminated instructions must not hide the rest of the document.
    let mut open = Vec::new();
    let mut closed = HashSet::new();
    for n in body.descendants().filter(|n| is(*n, W, "fldChar")) {
        match n.attribute((W, "fldCharType")) {
            Some("begin") => open.push(n.id()),
            Some("end") => if let Some(id) = open.pop() { closed.insert(id); },
            _ => {}
        }
    }
    let mut images = HashMap::new();
    let mut fields = Vec::new();
    let mut after_ignored = false;
    for n in body.children().filter(|n| n.is_element()) {
        if is(n, W, "p") {
            paragraph(n, &mut out, &mut zip, &rels, &mut images, &mut fields, &closed, styles_doc.as_ref());
            if after_ignored || styles_doc.as_ref().is_some_and(|styles| inherits_list(n, styles)) {
                out.blocks.last_mut().unwrap().simple_caption = false;
            }
            after_ignored = false;
        } else if is(n, W, "tbl") && simple_table(n) {
            after_ignored = false;
            let first_row = n.children().find(|x| is(*x, W, "tr")).unwrap();
            if !child(first_row, W, "trPr").is_some_and(|p| enabled(p, "tblHeader")) {
                warn_at(&mut out, "table_header_assumed", n);
            }
            for row in n.children().filter(|x| is(*x, W, "tr")).skip(1)
                .filter(|row| child(*row, W, "trPr").is_some_and(|p| enabled(p, "tblHeader"))) {
                warn_at(&mut out, "table_header_rows_degraded", row);
            }
            let mut rows = Vec::new();
            for row in n.children().filter(|x| is(*x, W, "tr")) {
                let mut cells = Vec::new();
                for cell in row.children().filter(|x| is(*x, W, "tc")) {
                    let start = out.blocks.len();
                    for p in cell.children().filter(|x| is(*x, W, "p")) {
                        paragraph(p, &mut out, &mut zip, &rels, &mut images, &mut fields, &closed, styles_doc.as_ref());
                    }
                    let mut paragraphs = out.blocks.split_off(start);
                    if paragraphs.len() > 1 || paragraphs.iter().any(|p| p.inlines.iter().any(|i| matches!(i, Inline::Break))) {
                        warn_at(&mut out, "table_cell_structure_degraded", cell);
                    }
                    for p in &mut paragraphs {
                        for inline in &mut p.inlines {
                            if matches!(inline, Inline::Break) {
                                *inline = Inline::Text { text: " ".into(), bold: false, italic: false, strike: false };
                            }
                        }
                    }
                    cells.push(paragraphs);
                }
                rows.push(cells);
            }
            out.blocks.push(Block { heading_level: None, simple_caption: false, list: None, inlines: vec![Inline::Table(rows)] });
        } else if !is(n, W, "sectPr") {
            // Unsupported body elements can disappear or be flattened. Never infer
            // caption adjacency across that source boundary in either direction.
            if let Some(previous) = out.blocks.last_mut() { previous.simple_caption = false; }
            after_ignored = true;
            warn_at(
                &mut out,
                if is(n, W, "tbl") {
                    "table_unsupported"
                } else {
                    "body_content_unsupported"
                },
                n,
            );
            // Preserve textual content of unsupported containers in reading order.
            for p in n.descendants().filter(|p| is(*p, W, "p")) {
                paragraph(p, &mut out, &mut zip, &rels, &mut images, &mut fields, &closed, styles_doc.as_ref());
                // Flattened unsupported containers cannot establish body adjacency.
                out.blocks.last_mut().unwrap().simple_caption = false;
                // A heading-styled cell is still table content, not a chapter title.
                if is(n, W, "tbl") {
                    out.blocks.last_mut().unwrap().heading_level = None;
                }
            }
        } else {
            if let Some(previous) = out.blocks.last_mut() { previous.simple_caption = false; }
            after_ignored = true;
        }
    }
    if !fields.is_empty() {
        warn(&mut out, "field_unsupported");
    }
    let mut unsupported = false;
    resolve_lists(&mut out.blocks, numbering_doc.as_ref(), &mut unsupported);
    if unsupported {
        warn(&mut out, "list_numbering_unsupported");
    }
    Ok(out)
}

// Unknown or cyclic style chains are ambiguous, so do not strip heading text.
fn heading_style_may_number(p: Node<'_, '_>, styles: &Document<'_>) -> bool {
    let props = child(p, W, "pPr");
    if let Some(id) = props.and_then(|p| child(p, W, "numPr"))
        .and_then(|n| child(n, W, "numId")).and_then(val) {
        return id != "0";
    }
    let root = styles.root_element();
    let mut id = props.and_then(|p| child(p, W, "pStyle")).and_then(val)
        .or_else(|| root.children().find(|n| is(*n, W, "style") && n.attribute((W, "type")) == Some("paragraph")
            && matches!(n.attribute((W, "default")), Some("1" | "true" | "on")))
            .and_then(|n| n.attribute((W, "styleId"))));
    let mut visited = HashSet::new();
    while let Some(current) = id {
        if !visited.insert(current) { return true; }
        let Some(style) = root.children().find(|n| is(*n, W, "style") && n.attribute((W, "type")) == Some("paragraph")
            && n.attribute((W, "styleId")) == Some(current)) else { return true };
        if let Some(num) = child(style, W, "pPr").and_then(|p| child(p, W, "numPr")) {
            if let Some(id) = child(num, W, "numId").and_then(val) { return id != "0"; }
            return true;
        }
        id = child(style, W, "basedOn").and_then(val);
    }
    false
}

// Style numbering is not converted. Follow basedOn safely, respecting a closer
// numId (including 0, which explicitly removes numbering).
fn inherits_list(p: Node<'_, '_>, styles: &Document<'_>) -> bool {
    let props = child(p, W, "pPr");
    if props.and_then(|p| child(p, W, "numPr"))
        .and_then(|n| child(n, W, "numId")).and_then(val).is_some() {
        return false;
    }
    let root = styles.root_element();
    let mut id = props.and_then(|p| child(p, W, "pStyle")).and_then(val)
        .or_else(|| root.children().find(|n| is(*n, W, "style")
            && n.attribute((W, "type")) == Some("paragraph")
            && matches!(n.attribute((W, "default")), Some("1" | "true" | "on")))
            .and_then(|n| n.attribute((W, "styleId"))));
    let mut visited = HashSet::new();
    while let Some(current) = id {
        if !visited.insert(current) { break; }
        let Some(style) = root.children().find(|n| is(*n, W, "style")
            && n.attribute((W, "type")) == Some("paragraph")
            && n.attribute((W, "styleId")) == Some(current)) else { break };
        if let Some(num_id) = child(style, W, "pPr").and_then(|p| child(p, W, "numPr"))
            .and_then(|n| child(n, W, "numId")).and_then(val) {
            return num_id != "0";
        }
        id = child(style, W, "basedOn").and_then(val);
    }
    false
}

// Resolve each concrete numId through its abstract definition and optional level override.
fn resolve_lists(blocks: &mut [Block], doc: Option<&Document<'_>>, unsupported: &mut bool) {
    for block in blocks {
        if let Some(list) = &mut block.list {
            if let Some((ordered, start, style)) = doc.and_then(|d| list_definition(d, &list.id, list.level)) {
                list.ordered = ordered;
                list.start = start;
                list.style = style;
            } else {
                *unsupported = true;
            }
        }
        for inline in &mut block.inlines {
            if let Inline::Table(rows) = inline {
                for cell in rows.iter_mut().flatten() {
                    resolve_lists(cell, doc, unsupported);
                }
            }
        }
    }
}

fn list_definition(doc: &Document<'_>, id: &str, level: u8) -> Option<(bool, u32, Option<&'static str>)> {
    if level > 8 { return None; }
    let root = doc.root_element();
    let num = root.children().find(|n| is(*n, W, "num") && n.attribute((W, "numId")) == Some(id))?;
    let abstract_id = child(num, W, "abstractNumId").and_then(val)?;
    let abstract_num = root.children().find(|n| is(*n, W, "abstractNum") && n.attribute((W, "abstractNumId")) == Some(abstract_id))?;
    let matches_level = |n: Node<'_, '_>| n.attribute((W, "ilvl")).and_then(|v| v.parse::<u8>().ok()) == Some(level);
    let base = abstract_num.children().find(|n| is(*n, W, "lvl") && matches_level(*n));
    let over = num.children().find(|n| is(*n, W, "lvlOverride") && matches_level(*n));
    let lvl = over.and_then(|n| child(n, W, "lvl")).or(base)?;
    let format = child(lvl, W, "numFmt").and_then(val)?;
    let (ordered, symbol) = match format {
        "bullet" => (false, ""),
        "decimal" => (true, "1"),
        "lowerLetter" => (true, "a"),
        "upperLetter" => (true, "A"),
        "lowerRoman" => (true, "i"),
        "upperRoman" => (true, "I"),
        _ => return None,
    };
    let start_node = over.and_then(|n| child(n, W, "startOverride")).or_else(|| child(lvl, W, "start"));
    let start = match start_node { Some(n) => val(n)?.parse::<u32>().ok()?, None => 1 };
    if start > 999_999_999 { return None; }
    let style = if ordered {
        let text = child(lvl, W, "lvlText").and_then(val)?;
        let placeholder = format!("%{}", level + 1);
        let pattern = text.replace(&placeholder, symbol);
        match pattern.as_str() {
            "1." => None,
            "1)" => Some("1)"), "(1)" => Some("(1)"), "（1）" => Some("（1）"),
            "a." => Some("a."), "A." => Some("A."),
            "i." => Some("i."), "I." => Some("I."),
            _ => return None,
        }
    } else { None };
    Some((ordered, start, style))
}
// Complex Word grids cannot safely be represented as a simple GFM table. Preserve
// their paragraphs using the existing loss-aware fallback instead of misplacing text.
fn simple_table(table: Node<'_, '_>) -> bool {
    let rows: Vec<_> = table.children().filter(|n| is(*n, W, "tr")).collect();
    let Some(first) = rows.first() else { return false };
    let cols = first.children().filter(|n| is(*n, W, "tc")).count();
    // The converter only reads direct rows, cells and cell paragraphs. Reject
    // wrappers containing any additional structural nodes rather than dropping them.
    if table.descendants().any(|n| {
        (is(n, W, "tr") && n.parent() != Some(table))
            || (is(n, W, "tc") && !n.parent().is_some_and(|p| is(p, W, "tr") && p.parent() == Some(table)))
            || (is(n, W, "p") && !n.parent().is_some_and(|p| is(p, W, "tc") && p.parent().is_some_and(|r| is(r, W, "tr") && r.parent() == Some(table))))
    }) {
        return false;
    }
    cols > 0 && rows.iter().all(|row| {
        row.children().filter(|n| is(*n, W, "tc")).count() == cols
            && !row.descendants().any(|n| is(n, W, "gridSpan") || is(n, W, "vMerge") || is(n, W, "hMerge") || is(n, W, "tbl") || is(n, W, "gridBefore") || is(n, W, "gridAfter") || is(n, W, "numPr"))
    })
}
fn heading_level(p: Node<'_, '_>, styles: Option<&Document<'_>>) -> Option<u8> {
    let props = child(p, W, "pPr");
    let outline = |pr| child(pr, W, "outlineLvl").and_then(val)
        .and_then(|v| v.parse::<u8>().ok()).filter(|v| *v <= 9);
    if let Some(level) = props.and_then(outline) {
        return (level < 9).then_some(level + 1);
    }
    let mut id = props.and_then(|x| child(x, W, "pStyle")).and_then(val);
    let mut seen = HashSet::new();
    if let Some(styles) = styles {
        let root = styles.root_element();
        id = id.or_else(|| root.children().find(|n| is(*n, W, "style")
            && n.attribute((W, "type")) == Some("paragraph")
            && matches!(n.attribute((W, "default")), Some("1" | "true" | "on")))
            .and_then(|n| n.attribute((W, "styleId"))));
        while let Some(current) = id {
            if !seen.insert(current) { return None; }
            let style = root.children().find(|n| is(*n, W, "style")
                && n.attribute((W, "type")) == Some("paragraph")
                && n.attribute((W, "styleId")) == Some(current));
            if let Some(level) = style.and_then(|s| child(s, W, "pPr")).and_then(outline) {
                return (level < 9).then_some(level + 1);
            }
            if let Some(level) = builtin_heading(current) { return Some(level); }
            id = style.and_then(|s| child(s, W, "basedOn")).and_then(val);
        }
        None
    } else {
        id.and_then(builtin_heading)
    }
}
fn builtin_heading(id: &str) -> Option<u8> {
    id.strip_prefix("Heading").and_then(|s| s.parse::<u8>().ok())
        .filter(|v| (1..=9).contains(v))
}
// Word may serialize the built-in Caption style under a localized or numeric
// styleId. Resolve its name and inheritance rather than assuming the ID.
fn caption_style(id: Option<&str>, styles: Option<&Document<'_>>) -> bool {
    let mut id = id;
    let mut seen = HashSet::new();
    while let Some(current) = id {
        if !seen.insert(current) { return false; }
        if current.eq_ignore_ascii_case("Caption") { return true; }
        let style = styles.and_then(|doc| doc.root_element().children().find(|n| is(*n, W, "style")
            && n.attribute((W, "type")) == Some("paragraph")
            && n.attribute((W, "styleId")) == Some(current)));
        if style.and_then(|s| child(s, W, "name")).and_then(val)
            .is_some_and(|name| name.eq_ignore_ascii_case("caption") || name == "题注" || name == "標號") {
            return true;
        }
        id = style.and_then(|s| child(s, W, "basedOn")).and_then(val);
    }
    false
}
fn paragraph<Rd: Read + std::io::Seek>(
    p: Node<'_, '_>,
    out: &mut ImportedDocument,
    zip: &mut ZipArchive<Rd>,
    rels: &HashMap<String, String>,
    images: &mut HashMap<String, usize>,
    fields: &mut Vec<Field>,
    closed: &HashSet<roxmltree::NodeId>,
    styles: Option<&Document<'_>>,
) {
    let props = child(p, W, "pPr");
    let style = props.and_then(|x| child(x, W, "pStyle")).and_then(val);
    let heading_level = heading_level(p, styles);
    let list = props.and_then(|x| child(x, W, "numPr")).and_then(|n| {
        let id = child(n, W, "numId").and_then(val)?;
        if id == "0" {
            return None;
        }
        let level = child(n, W, "ilvl")
            .and_then(val)
            .and_then(|x| x.parse().ok())
            .unwrap_or(0);
        Some(List {
            id: id.to_owned(),
            level,
            ordered: false,
            start: 1,
            style: None,
        })
    });
    if heading_level.is_some() && list.is_some() {
        // Heading conversion consumes the title rather than its list marker.
        warn_at(out, "list_numbering_unsupported", p);
    }
    // Only a simple SEQ field with a numeric cached result is safe to treat like
    // literal caption numbering. Other fields and unsupported content stay text.
    // Complex fields may span paragraphs and are deliberately not consumed.
    let simple_run = |n: Node<'_, '_>| is(n, W, "r") && n.children().filter(|c| c.is_element())
        .all(|c| is(c, W, "rPr") || is(c, W, "t") || is(c, W, "tab"));
    // Only discard complete, paragraph-local bookmark ranges with unique IDs.
    // Partial or malformed ranges may carry meaning outside this paragraph.
    let mut bookmarks = Vec::new();
    let mut bookmark_ids = HashSet::new();
    let mut seq_count = 0;
    // Some producers use direct centered, keep-with-next formatting instead of
    // Word's Caption style. Require both signals; adjacency is checked later.
    let direct_caption = props.is_some_and(|pr| {
        child(pr, W, "jc").and_then(val) == Some("center")
            && child(pr, W, "keepNext").is_some_and(|n| !matches!(val(n), Some("0" | "false" | "off")))
    });
    let simple_caption = (caption_style(style, styles) || direct_caption) && fields.is_empty()
        && !props.is_some_and(|pr| child(pr, W, "numPr").is_some())
        && p.children().filter(|n| n.is_element()).all(|n| {
            if is(n, W, "pPr") || simple_run(n) { return true; }
            if is(n, W, "bookmarkStart") || is(n, W, "bookmarkEnd") {
                let Some(id) = n.attribute((W, "id")).and_then(|id| id.parse::<u32>().ok()) else { return false };
                if n.children().any(|c| c.is_element()) || n.attribute((W, "colFirst")).is_some() || n.attribute((W, "colLast")).is_some() { return false; }
                if is(n, W, "bookmarkStart") {
                    if !bookmark_ids.insert(id) { return false; }
                    bookmarks.push(id);
                    return true;
                }
                return bookmarks.pop() == Some(id);
            }
            if !is(n, W, "fldSimple") { return false; }
            seq_count += 1;
            let instruction = n.attribute((W, "instr")).unwrap_or("");
            let parts: Vec<_> = instruction.split_whitespace().collect();
            let valid_instruction = (parts.len() == 2 || (parts.len() == 4 && parts[2] == "\\*" && parts[3].eq_ignore_ascii_case("ARABIC")))
                && parts[0].eq_ignore_ascii_case("SEQ")
                && ["图", "表", "Figure", "Table"].iter().any(|label| parts[1].eq_ignore_ascii_case(label));
            let result: String = n.descendants().filter(|c| is(*c, W, "t")).filter_map(|c| c.text()).collect();
            valid_instruction && !result.is_empty() && result.chars().all(|c| c.is_ascii_digit())
                && n.children().filter(|c| c.is_element()).all(simple_run)
        }) && seq_count <= 1 && bookmarks.is_empty();
    let mut block = Block {
        heading_level,
        simple_caption,
        inlines: vec![],
        list,
    };
    for n in p.descendants().filter(|n| n.is_element()) {
        // Properties may contain elements such as w:tab that describe layout,
        // not content. Never interpret them as run content or issue warnings.
        if n.ancestors().any(|a| is(a, W, "pPr") || is(a, W, "rPr")) {
            continue;
        }
        if is(n, W, "fldChar") {
            match n.attribute((W, "fldCharType")) {
                Some("begin") => {
                    if !closed.contains(&n.id()) { warn_at(out, "field_unsupported", p); }
                    fields.push(Field { closed: closed.contains(&n.id()), ..Field::default() });
                },
                Some("separate") => {
                    if let Some(field) = fields.last_mut() {
                        if field.result || !common_field(&field.instruction) { warn_at(out, "field_unsupported", n); }
                        field.result = true;
                    } else { warn_at(out, "field_unsupported", n); }
                }
                Some("end") => {
                    if fields.pop().is_none_or(|field| !field.result) { warn_at(out, "field_unsupported", n); }
                }
                _ => warn_at(out, "field_unsupported", n),
            }
            continue;
        }
        if is(n, W, "instrText") {
            if let Some(field) = fields.last_mut().filter(|field| !field.result) {
                field.instruction.push_str(n.text().unwrap_or(""));
            } else { warn_at(out, "field_unsupported", n); }
            continue;
        }
        if fields.iter().any(|field| field.closed && !field.result) { continue; }
        if is(n, W, "fldSimple") && !n.attribute((W, "instr")).is_some_and(common_field) {
            warn_at(out, "field_unsupported", n);
        }
        if is(n, W, "hyperlink") {
            warn_at(out, "hyperlink_target_unsupported", n);
        }
        if is(n, W, "drawing") || is(n, W, "pict") || is(n, W, "object") {
            if !is(n, W, "drawing") || !n.descendants().any(|x| is(x, A, "blip")) {
                warn_at(out, "drawing_unsupported", n);
            }
        }
        if is(n, W, "footnoteReference") || is(n, W, "endnoteReference") {
            warn_at(out, "note_unsupported", n);
        }
        if n.tag_name()
            .namespace()
            .is_some_and(|ns| ns.contains("officeDocument/2006/math"))
        {
            warn_at(out, "math_unsupported", n);
        }
        if is(n, W, "t") {
            let run = n.ancestors().find(|x| is(*x, W, "r"));
            let rp = run.and_then(|r| child(r, W, "rPr"));
            block.inlines.push(Inline::Text {
                text: n.text().unwrap_or("").to_owned(),
                bold: rp.is_some_and(|r| enabled(r, "b")),
                italic: rp.is_some_and(|r| enabled(r, "i")),
                strike: rp.is_some_and(|r| enabled(r, "strike")),
            });
        } else if is(n, W, "tab") {
            block.inlines.push(Inline::Tab);
        } else if is(n, W, "br") || is(n, W, "cr") {
            // Page and column breaks are layout, not line breaks. Their position
            // cannot be represented in Markdown; report the loss without adding a newline.
            if is(n, W, "br") && matches!(n.attribute((W, "type")), Some("page" | "column")) {
                warn_at(out, "body_content_unsupported", n);
            } else {
                block.inlines.push(Inline::Break);
            }
        } else if is(n, A, "blip") {
            let Some(id) = n.attribute((R, "embed")) else {
                warn_at(out, "image_external_or_missing", n);
                continue;
            };
            if let Some(index) = images.get(id) {
                block.inlines.push(Inline::Image(*index));
                continue;
            }
            let Some(target) = rels.get(id) else {
                warn_at(out, "image_external_or_missing", n);
                continue;
            };
            // Only package-local media paths; never follow traversal or external URLs.
            let Some(name) = target.strip_prefix("media/") else {
                warn_at(out, "image_path_unsupported", n);
                continue;
            };
            if name.is_empty()
                || name.contains('/')
                || name.contains('\\')
                || name == "."
                || name == ".."
            {
                warn_at(out, "image_path_unsupported", n);
                continue;
            }
            let Ok(bytes) = read_part(zip, &format!("word/media/{name}"), MAX_IMAGE) else {
                warn_at(out, "image_unreadable", n);
                continue;
            };
            let ext = if bytes.starts_with(b"\x89PNG\r\n\x1a\n") {
                "png"
            } else if bytes.starts_with(b"\xff\xd8\xff") {
                "jpg"
            } else if bytes.starts_with(b"GIF87a") || bytes.starts_with(b"GIF89a") {
                "gif"
            } else {
                warn_at(out, "image_format_unsupported", n);
                continue;
            };
            let index = out.images.len();
            out.images.push(Image {
                extension: ext,
                bytes,
            });
            images.insert(id.to_owned(), index);
            block.inlines.push(Inline::Image(index));
        }
    }
    if block.heading_level.is_some() && !p.ancestors().any(|n| is(n, W, "tbl"))
        && block.inlines.iter().any(|i| matches!(i, Inline::Image(_))) {
        warn_at(out, "heading_image_unsupported", p);
    }
    out.blocks.push(block);
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Write;
    fn archive(document: &str, extra: &[(&str, &[u8])]) -> Vec<u8> {
        let mut z = zip::ZipWriter::new(Cursor::new(Vec::new()));
        let opt = zip::write::SimpleFileOptions::default();
        z.start_file("word/document.xml", opt).unwrap();
        z.write_all(document.as_bytes()).unwrap();
        for (name, bytes) in extra {
            z.start_file(*name, opt).unwrap();
            z.write_all(bytes).unwrap();
        }
        z.finish().unwrap().into_inner()
    }
    fn wrap(body: &str) -> String {
        format!("<w:document xmlns:w='{W}' xmlns:r='{R}' xmlns:a='{A}'><w:body>{body}</w:body></w:document>")
    }
    #[test]
    fn warning_details_identify_source_blocks_cells_and_content() {
        let d = wrap("<w:p><w:hyperlink><w:r><w:t>一</w:t></w:r></w:hyperlink><w:hyperlink/></w:p><w:p><w:hyperlink/></w:p><w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p/></w:tc><w:tc><w:p><w:r><w:drawing><a:blip/></w:drawing></w:r></w:p></w:tc></w:tr></w:tbl><w:sectPr/>");
        let result = convert_bytes(&archive(&d, &[])).unwrap();
        assert_eq!(result.warnings, ["hyperlink_target_unsupported", "image_external_or_missing"]);
        let details = serde_json::to_value(&result.warning_details).unwrap();
        assert_eq!(details, serde_json::json!([
            {"code":"hyperlink_target_unsupported", "location":{"block":1}, "contentType":"超链接", "nearbyText":"一"},
            {"code":"hyperlink_target_unsupported", "location":{"block":2}, "contentType":"超链接", "nearbyText":"一"},
            {"code":"image_external_or_missing", "location":{"block":3,"tableIndex":1,"row":1,"cell":2}, "contentType":"图片", "nearbyText":"一"}
        ]));
    }
    #[test]
    fn empty_warning_context_uses_nearby_text_with_table_priority() {
        let d = wrap("<w:p><w:r><w:t>前文</w:t></w:r></w:p><w:p><w:r><w:drawing><a:blip/></w:drawing></w:r></w:p><w:p/><w:p><w:r><w:t>后文</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:drawing><a:blip/></w:drawing></w:r></w:p><w:p><w:r><w:t>单元文字</w:t></w:r></w:p></w:tc><w:tc><w:p><w:r><w:t>其他单元</w:t></w:r></w:p></w:tc></w:tr></w:tbl>");
        let result = convert_bytes(&archive(&d, &[])).unwrap();
        let details: Vec<_> = result.warning_details.iter().filter(|d| d.code == "image_external_or_missing").collect();
        assert_eq!(details.len(), 2);
        assert_eq!(details[0].nearby_text.as_deref(), Some("前文"));
        assert_eq!(details[1].nearby_text.as_deref(), Some("单元文字"));
        let d = wrap("<w:p><w:r><w:drawing><a:blip/></w:drawing></w:r></w:p><w:p/><w:p><w:r><w:t>后文</w:t></w:r></w:p>");
        let result = convert_bytes(&archive(&d, &[])).unwrap();
        assert_eq!(result.warning_details[0].nearby_text.as_deref(), Some("后文"));
        let d = wrap("<w:p><w:r><w:drawing><a:blip/></w:drawing></w:r></w:p>");
        assert_eq!(convert_bytes(&archive(&d, &[])).unwrap().warning_details[0].nearby_text, None);
    }
    #[test]
    fn warning_context_is_bounded_and_tables_count_source_order() {
        let long = "文".repeat(100);
        let d = wrap(&format!("<w:tbl><w:tr><w:tc><w:p/></w:tc></w:tr></w:tbl><w:p><w:r><w:t>{long}</w:t></w:r><w:hyperlink/></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t> 单元 </w:t></w:r><w:hyperlink/></w:p></w:tc></w:tr></w:tbl>"));
        let result = convert_bytes(&archive(&d, &[])).unwrap();
        let details: Vec<_> = result.warning_details.iter().filter(|d| d.code == "hyperlink_target_unsupported").collect();
        assert_eq!(details.len(), 2);
        assert_eq!(details[0].nearby_text.as_deref(), Some("文".repeat(80).as_str()));
        assert_eq!(details[0].location.table_index, None);
        assert_eq!(details[1].nearby_text.as_deref(), Some("单元"));
        assert_eq!(details[1].location.table_index, Some(2));
        assert_eq!(details[1].location.row, Some(1));
    }
    #[test]
    fn cached_field_results_and_nested_fields_are_preserved() {
        let d = wrap("<w:p><w:r><w:t>前</w:t><w:fldChar w:fldCharType='begin'/><w:instrText> PA</w:instrText><w:instrText>GE </w:instrText><w:t>不可见</w:t><w:fldChar w:fldCharType='separate'/><w:t>12</w:t><w:fldChar w:fldCharType='end'/></w:r><w:fldSimple w:instr=' REF bookmark '><w:r><w:rPr><w:b/></w:rPr><w:t>引用</w:t></w:r></w:fldSimple></w:p><w:p><w:r><w:fldChar w:fldCharType='begin'/><w:instrText> TOC </w:instrText><w:fldChar w:fldCharType='separate'/><w:t>目录</w:t></w:r></w:p><w:p><w:r><w:fldChar w:fldCharType='begin'/><w:instrText> PAGE </w:instrText><w:fldChar w:fldCharType='separate'/><w:t>3</w:t><w:fldChar w:fldCharType='end'/><w:fldChar w:fldCharType='end'/><w:t>后</w:t></w:r></w:p>");
        let result = convert_bytes(&archive(&d, &[])).unwrap();
        assert!(result.warnings.is_empty());
        let texts: Vec<_> = result.blocks.iter().map(|b| b.inlines.iter().filter_map(|i| match i { Inline::Text { text, .. } => Some(text.as_str()), _ => None }).collect::<String>()).collect();
        assert_eq!(texts, ["前12引用", "目录", "3后"]);
        assert!(matches!(&result.blocks[0].inlines[2], Inline::Text { bold: true, .. }));
    }
    #[test]
    fn unclosed_instruction_does_not_hide_later_content() {
        let d = wrap("<w:p><w:r><w:fldChar w:fldCharType='begin'/><w:instrText> PAGE </w:instrText><w:t>同段正文</w:t></w:r></w:p><w:p><w:r><w:t>后续正文</w:t><w:tab/><w:t>末尾</w:t></w:r></w:p>");
        let result = convert_bytes(&archive(&d, &[])).unwrap();
        assert_eq!(result.warnings, ["field_unsupported"]);
        assert!(matches!(&result.blocks[0].inlines[..], [Inline::Text { text, .. }] if text == "同段正文"));
        assert!(matches!(&result.blocks[1].inlines[..], [Inline::Text { text, .. }, Inline::Tab, Inline::Text { text: end, .. }] if text == "后续正文" && end == "末尾"));
    }
    #[test]
    fn unknown_and_incomplete_fields_warn_without_losing_cached_text() {
        let d = wrap("<w:p><w:fldSimple w:instr='CUSTOM x'><w:r><w:t>简单结果</w:t></w:r></w:fldSimple><w:r><w:fldChar w:fldCharType='begin'/><w:instrText> CUSTOM </w:instrText><w:fldChar w:fldCharType='separate'/><w:t>复杂结果</w:t><w:fldChar w:fldCharType='end'/><w:fldChar w:fldCharType='begin'/><w:instrText> PAGE </w:instrText></w:r></w:p>");
        let result = convert_bytes(&archive(&d, &[])).unwrap();
        assert_eq!(result.warnings, ["field_unsupported"]);
        assert!(matches!(&result.blocks[0].inlines[..], [Inline::Text { text: a, .. }, Inline::Text { text: b, .. }] if a == "简单结果" && b == "复杂结果"));
    }
    #[test]
    fn numbering_definitions_and_overrides() {
        let paragraph = |id, level| format!("<w:p><w:pPr><w:numPr><w:ilvl w:val='{level}'/><w:numId w:val='{id}'/></w:numPr></w:pPr></w:p>");
        let d = wrap(&(paragraph(1, 0) + &paragraph(1, 1) + &paragraph(2, 0)));
        let numbering = format!("<w:numbering xmlns:w='{W}'><w:abstractNum w:abstractNumId='4'><w:lvl w:ilvl='0'><w:start w:val='3'/><w:numFmt w:val='upperLetter'/><w:lvlText w:val='%1.'/></w:lvl><w:lvl w:ilvl='1'><w:numFmt w:val='bullet'/></w:lvl></w:abstractNum><w:num w:numId='1'><w:abstractNumId w:val='4'/><w:lvlOverride w:ilvl='0'><w:startOverride w:val='7'/></w:lvlOverride></w:num><w:num w:numId='2'><w:abstractNumId w:val='4'/><w:lvlOverride w:ilvl='0'><w:lvl w:ilvl='0'><w:numFmt w:val='lowerRoman'/><w:lvlText w:val='%1.'/></w:lvl></w:lvlOverride></w:num></w:numbering>");
        let result = convert_bytes(&archive(&d, &[("word/numbering.xml", numbering.as_bytes())])).unwrap();
        assert_eq!(result.blocks[0].list, Some(List { id: "1".into(), level: 0, ordered: true, start: 7, style: Some("A.") }));
        assert_eq!(result.blocks[1].list, Some(List { id: "1".into(), level: 1, ordered: false, start: 1, style: None }));
        assert_eq!(result.blocks[2].list, Some(List { id: "2".into(), level: 0, ordered: true, start: 1, style: Some("i.") }));
        assert!(result.warnings.is_empty());
    }
    #[test]
    fn missing_or_unsupported_numbering_warns() {
        let d = wrap("<w:p><w:pPr><w:numPr><w:numId w:val='1'/></w:numPr></w:pPr></w:p>");
        assert_eq!(convert_bytes(&archive(&d, &[])).unwrap().warnings, vec!["list_numbering_unsupported"]);
        let numbering = format!("<w:numbering xmlns:w='{W}'><w:abstractNum w:abstractNumId='1'><w:lvl w:ilvl='0'><w:numFmt w:val='chineseCounting'/></w:lvl></w:abstractNum><w:num w:numId='1'><w:abstractNumId w:val='1'/></w:num></w:numbering>");
        assert_eq!(convert_bytes(&archive(&d, &[("word/numbering.xml", numbering.as_bytes())])).unwrap().warnings, vec!["list_numbering_unsupported"]);
        assert!(convert_bytes(&archive(&d, &[("word/numbering.xml", b"<broken")])).is_err());
    }
    #[test]
    fn numbered_heading_warns_even_with_supported_definition() {
        let d = wrap("<w:p><w:pPr><w:pStyle w:val='Heading1'/><w:numPr><w:numId w:val='1'/></w:numPr></w:pPr><w:r><w:t>标题</w:t></w:r></w:p>");
        let numbering = format!("<w:numbering xmlns:w='{W}'><w:abstractNum w:abstractNumId='1'><w:lvl w:ilvl='0'><w:numFmt w:val='decimal'/><w:lvlText w:val='%1.'/></w:lvl></w:abstractNum><w:num w:numId='1'><w:abstractNumId w:val='1'/></w:num></w:numbering>");
        let result = convert_bytes(&archive(&d, &[("word/numbering.xml", numbering.as_bytes())])).unwrap();
        assert_eq!(result.warnings, ["list_numbering_unsupported"]);
        assert_eq!(result.blocks[0].heading_level, Some(1));
        assert!(matches!(&result.blocks[0].inlines[..], [Inline::Text { text, .. }] if text == "标题"));
    }
    #[test]
    fn inherited_style_numbering_warns_and_respects_overrides_and_cycles() {
        let styles = format!("<w:styles xmlns:w='{W}'><w:style w:type='paragraph' w:styleId='Base'><w:pPr><w:numPr><w:numId w:val='2'/></w:numPr></w:pPr></w:style><w:style w:type='paragraph' w:styleId='Middle'><w:basedOn w:val='Base'/></w:style><w:style w:type='paragraph' w:styleId='Heading1'><w:basedOn w:val='Middle'/></w:style><w:style w:type='paragraph' w:styleId='Off'><w:basedOn w:val='Base'/><w:pPr><w:numPr><w:numId w:val='0'/></w:numPr></w:pPr></w:style><w:style w:type='paragraph' w:styleId='Cycle'><w:basedOn w:val='Cycle'/></w:style></w:styles>");
        let parts = [("word/styles.xml", styles.as_bytes())];
        for name in ["Base", "Middle", "Heading1"] {
            let d = wrap(&format!("<w:p><w:pPr><w:pStyle w:val='{name}'/></w:pPr><w:r><w:t>内容</w:t></w:r></w:p>"));
            let result = convert_bytes(&archive(&d, &parts)).unwrap();
            assert_eq!(result.warnings, ["list_numbering_unsupported"], "{name}");
            assert!(matches!(&result.blocks[0].inlines[..], [Inline::Text { text, .. }] if text == "内容"));
        }
        let d = wrap("<w:p><w:pPr><w:pStyle w:val='Off'/></w:pPr></w:p><w:p><w:pPr><w:pStyle w:val='Cycle'/></w:pPr></w:p><w:p><w:pPr><w:pStyle w:val='Base'/><w:numPr><w:numId w:val='0'/></w:numPr></w:pPr></w:p>");
        assert!(convert_bytes(&archive(&d, &parts)).unwrap().warnings.is_empty());
        assert!(convert_bytes(&archive(&d, &[("word/styles.xml", b"<broken")])).is_err());
    }
    #[test]
    fn property_tabs_are_not_content_and_page_breaks_are_reported() {
        let d = wrap("<w:p><w:pPr><w:tabs><w:tab w:val='left' w:pos='720'/></w:tabs></w:pPr><w:r><w:rPr><w:tabs><w:tab/></w:tabs></w:rPr><w:t>A</w:t><w:tab/><w:t>B</w:t><w:br w:type='page'/><w:t>C</w:t><w:br w:type='column'/><w:br/><w:t>D</w:t></w:r></w:p>");
        let result = convert_bytes(&archive(&d, &[])).unwrap();
        assert_eq!(result.warnings, ["body_content_unsupported"]);
        assert!(matches!(&result.blocks[0].inlines[..], [Inline::Text { text: a, .. }, Inline::Tab, Inline::Text { text: b, .. }, Inline::Text { text: c, .. }, Inline::Break, Inline::Text { text: d, .. }] if a == "A" && b == "B" && c == "C" && d == "D"));
    }
    #[test]
    fn embedded_object_is_reported_without_losing_adjacent_text() {
        let d = wrap("<w:p><w:r><w:t>前</w:t><w:object/><w:t>后</w:t></w:r></w:p>");
        let result = convert_bytes(&archive(&d, &[])).unwrap();
        assert_eq!(result.warnings, ["drawing_unsupported"]);
        assert!(matches!(&result.blocks[0].inlines[..], [Inline::Text { text: a, .. }, Inline::Text { text: b, .. }] if a == "前" && b == "后"));
    }
    #[test]
    fn headings_runs_and_table() {
        let d = wrap("<w:p><w:pPr><w:pStyle w:val='Heading2'/></w:pPr><w:r><w:rPr><w:b/></w:rPr><w:t>标题 &amp; text</w:t></w:r></w:p><w:tbl><w:tr><w:tc><w:p><w:r><w:t>cell</w:t></w:r></w:p></w:tc></w:tr></w:tbl>");
        let result = convert_bytes(&archive(&d, &[])).unwrap();
        assert_eq!(result.blocks[0].heading_level, Some(2));
        assert_eq!(
            result.blocks[0].inlines[0],
            Inline::Text {
                text: "标题 & text".into(),
                bold: true,
                italic: false,
                strike: false
            }
        );
        assert_eq!(result.blocks.len(), 2);
        assert!(matches!(&result.blocks[1].inlines[..], [Inline::Table(rows)] if rows.len() == 1));
        assert_eq!(result.warnings, vec!["table_header_assumed"]);
    }
    #[test]
    fn table_header_and_cell_structure_warnings() {
        let d = wrap("<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p><w:r><w:t>one</w:t><w:br/><w:t>two</w:t><w:cr/><w:t>three</w:t></w:r></w:p><w:p><w:r><w:t>four</w:t></w:r></w:p></w:tc></w:tr></w:tbl>");
        let result = convert_bytes(&archive(&d, &[])).unwrap();
        assert_eq!(result.warnings, vec!["table_cell_structure_degraded"]);
        assert!(matches!(&result.blocks[0].inlines[..], [Inline::Table(rows)] if rows[0][0].len() == 2 && matches!(&rows[0][0][0].inlines[1], Inline::Text { text, .. } if text == " ")));
        let disabled = wrap("<w:tbl><w:tr><w:trPr><w:tblHeader w:val='0'/></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>");
        assert_eq!(convert_bytes(&archive(&disabled, &[])).unwrap().warnings, vec!["table_header_assumed"]);
    }
    #[test]
    fn additional_header_rows_are_reported() {
        let d = wrap("<w:tbl><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p/></w:tc></w:tr><w:tr><w:trPr><w:tblHeader/></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>");
        let result = convert_bytes(&archive(&d, &[])).unwrap();
        assert_eq!(result.warnings, vec!["table_header_rows_degraded"]);
        let disabled = d.replace("<w:tblHeader/></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>", "<w:tblHeader w:val='0'/></w:trPr><w:tc><w:p/></w:tc></w:tr></w:tbl>");
        assert!(convert_bytes(&archive(&disabled, &[])).unwrap().warnings.is_empty());
    }
    #[test]
    fn wrapped_table_content_falls_back_in_reading_order() {
        for body in [
            "<w:tr><w:tc><w:p><w:r><w:t>first</w:t></w:r></w:p><w:sdt><w:sdtContent><w:p><w:r><w:t>second</w:t></w:r></w:p></w:sdtContent></w:sdt></w:tc></w:tr>",
            "<w:tr><w:tc><w:p><w:r><w:t>first</w:t></w:r></w:p></w:tc><w:sdt><w:sdtContent><w:tc><w:p><w:r><w:t>second</w:t></w:r></w:p></w:tc></w:sdtContent></w:sdt></w:tr>",
            "<w:tr><w:tc><w:p><w:r><w:t>first</w:t></w:r></w:p></w:tc></w:tr><w:sdt><w:sdtContent><w:tr><w:tc><w:p><w:r><w:t>second</w:t></w:r></w:p></w:tc></w:tr></w:sdtContent></w:sdt>",
        ] {
            let result = convert_bytes(&archive(&wrap(&format!("<w:tbl>{body}</w:tbl>")), &[])).unwrap();
            assert_eq!(result.warnings, vec!["table_unsupported"]);
            assert_eq!(result.blocks.len(), 2);
            for (block, expected) in result.blocks.iter().zip(["first", "second"]) {
                assert!(matches!(&block.inlines[..], [Inline::Text { text, .. }] if text == expected));
            }
        }
    }
    #[test]
    fn complex_table_falls_back_without_losing_text() {
        let d = wrap("<w:tbl><w:tr><w:tc><w:tcPr><w:gridSpan w:val='2'/></w:tcPr><w:p><w:r><w:t>merged</w:t></w:r></w:p></w:tc></w:tr></w:tbl>");
        let result = convert_bytes(&archive(&d, &[])).unwrap();
        assert_eq!(result.warnings, vec!["table_unsupported"]);
        assert!(matches!(&result.blocks[0].inlines[0], Inline::Text { text, .. } if text == "merged"));
    }
    #[test]
    fn style_outline_and_inheritance_determine_heading_levels() {
        let styles = format!("<w:styles xmlns:w='{W}'><w:style w:type='paragraph' w:styleId='Base'><w:pPr><w:outlineLvl w:val='1'/><w:numPr><w:numId w:val='2'/></w:numPr></w:pPr></w:style><w:style w:type='paragraph' w:styleId='Custom'><w:basedOn w:val='Base'/></w:style><w:style w:type='paragraph' w:styleId='Off'><w:basedOn w:val='Base'/><w:pPr><w:outlineLvl w:val='9'/></w:pPr></w:style><w:style w:type='paragraph' w:styleId='Cycle'><w:basedOn w:val='Cycle'/></w:style></w:styles>");
        let d = wrap("<w:p><w:pPr><w:pStyle w:val='Custom'/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val='Off'/></w:pPr></w:p><w:p><w:pPr><w:pStyle w:val='Cycle'/></w:pPr></w:p><w:p><w:pPr><w:pStyle w:val='Custom'/><w:outlineLvl w:val='0'/></w:pPr></w:p>");
        let result = convert_bytes(&archive(&d, &[("word/styles.xml", styles.as_bytes())])).unwrap();
        assert_eq!(result.blocks.iter().map(|b| b.heading_level).collect::<Vec<_>>(), vec![Some(2), None, None, Some(1)]);
        assert!(result.heading_numbering_possible);
    }
    #[test]
    fn explicit_body_outline_overrides_heading_style() {
        let d = wrap("<w:p><w:pPr><w:pStyle w:val='Heading1'/><w:outlineLvl w:val='9'/></w:pPr><w:r><w:t>正文</w:t></w:r></w:p><w:p><w:pPr><w:pStyle w:val='Heading1'/><w:outlineLvl w:val='2'/></w:pPr><w:r><w:t>标题</w:t></w:r></w:p>");
        let result = convert_bytes(&archive(&d, &[])).unwrap();
        assert_eq!(result.blocks[0].heading_level, None);
        assert_eq!(result.blocks[1].heading_level, Some(3));
    }
    #[test]
    fn embedded_images_are_deduplicated_and_external_rejected() {
        let d = wrap("<w:p><w:r><w:drawing><a:blip r:embed='r1'/><a:blip r:embed='r1'/><a:blip r:link='x'/></w:drawing></w:r></w:p>");
        let rel = format!("<Relationships xmlns='{REL}'><Relationship Id='r1' Type='{R}/image' Target='media/a.png'/></Relationships>");
        let result = convert_bytes(&archive(
            &d,
            &[
                ("word/_rels/document.xml.rels", rel.as_bytes()),
                ("word/media/a.png", b"\x89PNG\r\n\x1a\nimage"),
            ],
        ))
        .unwrap();
        assert_eq!(result.images.len(), 1);
        assert_eq!(
            result.blocks[0].inlines,
            vec![Inline::Image(0), Inline::Image(0)]
        );
        assert_eq!(result.warnings, vec!["image_external_or_missing"]);
    }
    #[test]
    fn malformed_and_oversized_relationships_are_errors() {
        let d = wrap("");
        assert!(convert_bytes(&archive(&d, &[("word/_rels/document.xml.rels", b"<broken")])).is_err());
        let oversized = vec![b' '; MAX_XML as usize + 1];
        assert!(convert_bytes(&archive(&d, &[("word/_rels/document.xml.rels", &oversized)])).is_err());
        assert!(convert_bytes(&archive(&d, &[])).is_ok());
    }
    #[test]
    fn invalid_archive_and_traversal() {
        assert!(convert_bytes(b"bad").is_err());
        let d = wrap("<w:p><w:r><w:drawing><a:blip r:embed='x'/></w:drawing></w:r></w:p>");
        let rel = format!("<Relationships xmlns='{REL}'><Relationship Id='x' Type='{R}/image' Target='../secret'/></Relationships>");
        let result = convert_bytes(&archive(
            &d,
            &[("word/_rels/document.xml.rels", rel.as_bytes())],
        ))
        .unwrap();
        assert_eq!(result.warnings, vec!["image_path_unsupported"]);
    }
}
