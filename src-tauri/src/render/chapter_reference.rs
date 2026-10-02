//! 章节交叉引用的地址（docs/project-format.md 第 4.1 节）：`writer:chapter/<百分号编码的 id>[?show=number|title]`。
//! 与前端 `domain/chapter_reference` 的规则相同，由共享 Markdown fixture 约束。

use std::collections::HashMap;

use super::markdown::{Block, Inline};
use super::Document;

/// 引用的显示格式。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RefShow {
    NumberTitle,
    Number,
    Title,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct RefTarget {
    pub id: String,
    pub show: RefShow,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum Address {
    /// 不是 Writer 的地址：普通链接。
    Link,
    /// 以 `writer:` 开头但不符合格式：失效引用。
    Malformed,
    Ref(RefTarget),
}

const SCHEME: &str = "writer:";
const PREFIX: &str = "writer:chapter/";

pub fn parse_address(href: &str) -> Address {
    if !href.starts_with(SCHEME) {
        return Address::Link;
    }
    let Some(rest) = href.strip_prefix(PREFIX) else {
        return Address::Malformed;
    };
    let (encoded, query) = match rest.split_once('?') {
        Some((encoded, query)) => (encoded, Some(query)),
        None => (rest, None),
    };
    if encoded.contains(['/', '?', '#']) {
        return Address::Malformed;
    }
    let Some(id) = decode(encoded).filter(|id| !id.is_empty()) else {
        return Address::Malformed;
    };
    let show = match query {
        None => RefShow::NumberTitle,
        Some(query) => match query.strip_prefix("show=") {
            Some(value) if !value.contains(['&', '#']) => match value {
                "number" => RefShow::Number,
                "title" => RefShow::Title,
                // 未知的值按默认格式。
                _ => RefShow::NumberTitle,
            },
            _ => return Address::Malformed,
        },
    };
    Address::Ref(RefTarget { id, show })
}

/// 严格的百分号解码（与 JavaScript `decodeURIComponent` 相同）：% 后必须是两位十六进制，结果必须是 UTF-8。
fn decode(encoded: &str) -> Option<String> {
    let bytes = encoded.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = encoded.get(i + 1..i + 3)?;
            out.push(
                u8::from_str_radix(hex, 16)
                    .ok()
                    .filter(|_| hex.bytes().all(|b| b.is_ascii_hexdigit()))?,
            );
            i += 3;
        } else {
            out.push(bytes[i]);
            i += 1;
        }
    }
    String::from_utf8(out).ok()
}

/// 引用显示的文字（与前端 `chapterRefText` 相同）：number 是该输出中编号的写法，不显示编号时为 None。
/// 不显示编号时只有标题；标题为空时只有编号。
pub fn ref_text(number: Option<&str>, title: &str, show: RefShow) -> String {
    match number {
        None => title.to_owned(),
        Some(number) if title.is_empty() || show == RefShow::Number => number.to_owned(),
        Some(_) if show == RefShow::Title => title.to_owned(),
        Some(number) => format!("{number} {title}"),
    }
}

/// 可被引用的章节。
#[derive(Debug, Clone)]
pub struct ChapterTarget {
    /// 在 `Document::sections` 中的序号。
    pub index: usize,
    /// 显示编号，如 "2.1"；空串表示没有编号。
    pub number: String,
    pub title: String,
    /// 章节层级，根层级为 1。
    pub depth: usize,
}

/// 文档中的章节，按 id 查找引用目标。默认值不含任何章节（所有引用都失效）。
#[derive(Debug, Clone, Default)]
pub struct ChapterTargets {
    by_id: HashMap<String, ChapterTarget>,
}

impl ChapterTargets {
    pub fn new(document: &Document) -> Self {
        let by_id = document
            .sections
            .iter()
            .enumerate()
            .map(|(index, section)| {
                let target = ChapterTarget {
                    index,
                    number: section.number.clone(),
                    title: section.title.clone(),
                    depth: section.depth,
                };
                (section.chapter_id.clone(), target)
            })
            .collect();
        ChapterTargets { by_id }
    }

    /// 引用的目标章节；地址格式错误或章节不在文档中（失效引用）时为 None。
    pub fn get(&self, target: &Option<RefTarget>) -> Option<&ChapterTarget> {
        self.by_id(&target.as_ref()?.id)
    }

    pub fn by_id(&self, id: &str) -> Option<&ChapterTarget> {
        self.by_id.get(id)
    }
}

/// 文档中全部失效引用的链接文字，按阅读顺序（导出报告）。
pub fn broken_references(document: &Document) -> Vec<String> {
    let targets = ChapterTargets::new(document);
    let mut out = Vec::new();
    for section in &document.sections {
        broken_in_blocks(&section.blocks, &targets, &mut out);
    }
    out
}

fn broken_in_blocks(blocks: &[Block], targets: &ChapterTargets, out: &mut Vec<String>) {
    for block in blocks {
        match block {
            Block::Paragraph(inlines) => broken_in_inlines(inlines, targets, out),
            Block::List { items, .. } => {
                for item in items {
                    broken_in_blocks(item, targets, out);
                }
            }
            Block::Quote(children) => broken_in_blocks(children, targets, out),
            Block::Table { header, rows, .. } => {
                for cell in header.iter().chain(rows.iter().flatten()) {
                    broken_in_inlines(cell, targets, out);
                }
            }
            Block::Code { .. } | Block::Rule => {}
        }
    }
}

fn broken_in_inlines(inlines: &[Inline], targets: &ChapterTargets, out: &mut Vec<String>) {
    for inline in inlines {
        match inline {
            Inline::ChapterRef { target, cached } if targets.get(target).is_none() => {
                out.push(cached.clone())
            }
            Inline::Strong(children)
            | Inline::Emphasis(children)
            | Inline::Strike(children)
            | Inline::Link { children, .. } => broken_in_inlines(children, targets, out),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn target(id: &str, show: RefShow) -> Address {
        Address::Ref(RefTarget {
            id: id.to_owned(),
            show,
        })
    }

    #[test]
    fn links_and_references() {
        assert_eq!(parse_address("https://example.com"), Address::Link);
        assert_eq!(parse_address("WRITER:chapter/a"), Address::Link);
        assert_eq!(
            parse_address("writer:chapter/a1"),
            target("a1", RefShow::NumberTitle)
        );
        assert_eq!(
            parse_address("writer:chapter/a1?show=number"),
            target("a1", RefShow::Number)
        );
        assert_eq!(
            parse_address("writer:chapter/a1?show=title"),
            target("a1", RefShow::Title)
        );
        assert_eq!(
            parse_address("writer:chapter/a1?show=page"),
            target("a1", RefShow::NumberTitle)
        );
        assert_eq!(
            parse_address("writer:chapter/a1?show="),
            target("a1", RefShow::NumberTitle)
        );
        assert_eq!(
            parse_address("writer:chapter/%E7%AB%A0%2F1"),
            target("章/1", RefShow::NumberTitle)
        );
        assert_eq!(
            parse_address("writer:chapter/章"),
            target("章", RefShow::NumberTitle)
        );
    }

    #[test]
    fn reference_text() {
        assert_eq!(
            ref_text(Some("2.1"), "方法", RefShow::NumberTitle),
            "2.1 方法"
        );
        assert_eq!(ref_text(Some("2.1"), "方法", RefShow::Number), "2.1");
        assert_eq!(ref_text(Some("2.1"), "方法", RefShow::Title), "方法");
        assert_eq!(ref_text(None, "方法", RefShow::Number), "方法");
        assert_eq!(ref_text(Some("2.1"), "", RefShow::Title), "2.1");
        assert_eq!(
            ref_text(Some("第 2 章"), "方法", RefShow::NumberTitle),
            "第 2 章 方法"
        );
    }

    #[test]
    fn broken_references_in_reading_order() {
        let request = crate::render::RenderRequest {
            chapters: vec![
                crate::render::RenderChapter {
                    id: "a".into(),
                    number: vec![1],
                    title: "甲".into(),
                    markdown: "[有效](writer:chapter/b)、**[已删](writer:chapter/x)**\n\n> - [坏](writer:chapter/)\n".into(),
                },
                crate::render::RenderChapter {
                    id: "b".into(),
                    number: vec![2],
                    title: "乙".into(),
                    markdown: "| [表中](writer:chapter/y) |\n| --- |\n".into(),
                },
            ],
            ..Default::default()
        };
        assert_eq!(
            broken_references(&crate::render::build(&request)),
            vec!["已删", "坏", "表中"]
        );
    }

    #[test]
    fn malformed_addresses() {
        for href in [
            "writer:",
            "writer:figure/a",
            "writer:chapter/",
            "writer:chapter/a/b",
            "writer:chapter/a#x",
            "writer:chapter/a?",
            "writer:chapter/a?view=title",
            "writer:chapter/a?show=title&x=1",
            "writer:chapter/%zz",
            "writer:chapter/%+1",
            "writer:chapter/%C3",
            "writer:chapter/%",
            "writer:chapter/?show=title",
        ] {
            assert_eq!(parse_address(href), Address::Malformed, "{href}");
        }
    }
}
