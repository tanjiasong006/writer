//! 文献引用的编号（docs/decisions.md 第 13 节）：顺序编码制。
//!
//! 按阅读顺序（章节先序、块与行内内容的先后，脚注内容在它的引用处）第一次出现的顺序给被引用的条目编号，
//! 同一条目再次引用使用同一编号；不存在的条目不编号（失效引用）。只有被引用的条目进入参考文献表。
//! 与前端 `domain/bibliography` 的 `citationNumbers` 规则相同。

use std::collections::HashMap;

use super::markdown::{Block, Inline};
use super::{Document, RenderReference};

#[derive(Debug, Default)]
pub struct Citations {
    numbers: HashMap<String, usize>,
    /// 被引用的条目，按编号顺序。
    cited: Vec<RenderReference>,
}

impl Citations {
    pub fn new(document: &Document) -> Self {
        let entries: HashMap<&str, &RenderReference> =
            document.references.iter().map(|entry| (entry.id.as_str(), entry)).collect();
        let mut citations = Citations::default();
        for section in &document.sections {
            blocks(&section.blocks, &mut |id| {
                if citations.numbers.contains_key(id) {
                    return;
                }
                if let Some(entry) = entries.get(id) {
                    citations.cited.push((*entry).clone());
                    citations.numbers.insert(id.to_owned(), citations.cited.len());
                }
            });
        }
        citations
    }

    /// 条目的编号；不存在的条目为 None。
    pub fn number(&self, id: &str) -> Option<usize> {
        self.numbers.get(id).copied()
    }

    /// 参考文献表：（编号, 著录文字），按编号顺序。
    pub fn list(&self) -> impl Iterator<Item = (usize, &str)> {
        self.cited.iter().enumerate().map(|(index, entry)| (index + 1, entry.text.as_str()))
    }

    pub fn is_empty(&self) -> bool {
        self.cited.is_empty()
    }
}

fn blocks(blocks_: &[Block], visit: &mut dyn FnMut(&str)) {
    for block in blocks_ {
        match block {
            Block::Paragraph(content) => inlines(content, visit),
            Block::List { items, .. } => items.iter().for_each(|item| blocks(item, visit)),
            Block::Quote(children) => blocks(children, visit),
            Block::Table { header, rows, .. } => header
                .iter()
                .chain(rows.iter().flatten())
                .for_each(|cell| inlines(cell, visit)),
            Block::Code { .. } | Block::Rule => {}
        }
    }
}

fn inlines(content: &[Inline], visit: &mut dyn FnMut(&str)) {
    for inline in content {
        match inline {
            Inline::Citation { id, .. } => visit(id),
            Inline::Strong(children)
            | Inline::Emphasis(children)
            | Inline::Strike(children)
            | Inline::Superscript(children)
            | Inline::Subscript(children)
            | Inline::Link { children, .. }
            | Inline::Footnote(children) => inlines(children, visit),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::{build, RenderChapter, RenderRequest};

    #[test]
    fn numbered_in_order_of_first_citation() {
        let document = build(&RenderRequest {
            chapters: vec![
                RenderChapter {
                    id: "a".into(),
                    number: vec![1],
                    title: "甲".into(),
                    markdown: "见[[1]](writer:cite/b)与[[x]](writer:cite/gone)[^n]。\n\n[^n]: 脚注中[[2]](writer:cite/c)\n".into(),
                },
                RenderChapter {
                    id: "b".into(),
                    number: vec![2],
                    title: "乙".into(),
                    markdown: "| [[3]](writer:cite/a) |\n| - |\n\n再见[[1]](writer:cite/b)".into(),
                },
            ],
            references: ["a", "b", "c", "unused"]
                .iter()
                .map(|id| RenderReference { id: (*id).into(), text: format!("条目{id}") })
                .collect(),
            ..Default::default()
        });
        let citations = Citations::new(&document);
        assert_eq!(citations.number("b"), Some(1));
        assert_eq!(citations.number("c"), Some(2));
        assert_eq!(citations.number("a"), Some(3));
        assert_eq!(citations.number("gone"), None);
        assert_eq!(citations.list().collect::<Vec<_>>(), vec![(1, "条目b"), (2, "条目c"), (3, "条目a")]);
        assert_eq!(crate::render::chapter_reference::broken_references(&document), vec!["[x]"]);
    }
}
