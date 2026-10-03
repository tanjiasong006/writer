//! 图表的编号与引用目标（docs/decisions.md 第 12 节）。
//!
//! 有图注的独立图片是“图”，有标题的表格是“表”，按一级章节分组编号：“图 2-1”“表 3-2”。
//! 与前端 `ui/editor/element_numbering.ts` 的规则相同。编号按阅读顺序（章节先序、块的深度优先）分配，
//! 渲染器按块查找（同一个 Document 中块的地址不变），不依赖渲染时的遍历次数。

use std::collections::HashMap;

use super::chapter_reference::ElementKind;
use super::markdown::Block;
use super::Document;

/// 一个有编号的图或表。
#[derive(Debug, Clone, PartialEq)]
pub struct ElementTarget {
    pub kind: ElementKind,
    /// “图 2-1”。
    pub label: String,
    /// 全文中有编号的图表的序号：输出中锚点（PDF 标签、Word 书签）的名称。
    pub anchor: usize,
    /// 所在章节在 `Document::sections` 中的序号。
    pub section: usize,
}

#[derive(Debug, Default)]
pub struct ElementTargets {
    by_block: HashMap<usize, ElementTarget>,
    by_id: HashMap<(ElementKind, String), ElementTarget>,
}

impl ElementTargets {
    pub fn new(document: &Document) -> Self {
        let mut targets = ElementTargets::default();
        let mut chapter: Option<String> = None;
        let mut counts: HashMap<ElementKind, usize> = HashMap::new();
        let mut anchor = 0;
        for (section, part) in document.sections.iter().enumerate() {
            let top = part.number.split('.').next().unwrap_or("").to_owned();
            if chapter.as_deref() != Some(top.as_str()) {
                chapter = Some(top.clone());
                counts.clear();
            }
            let mut visit = |block: &Block, kind: ElementKind, id: Option<&str>| {
                let count = counts.entry(kind).or_insert(0);
                *count += 1;
                let name = match kind {
                    ElementKind::Figure => "图",
                    ElementKind::Table => "表",
                };
                let label = if top.is_empty() { format!("{name} {count}") } else { format!("{name} {top}-{count}") };
                let target = ElementTarget { kind, label, anchor, section };
                anchor += 1;
                if let Some(id) = id {
                    targets.by_id.entry((kind, id.to_owned())).or_insert_with(|| target.clone());
                }
                targets.by_block.insert(block as *const Block as usize, target);
            };
            walk(&part.blocks, &mut visit);
        }
        targets
    }

    /// 块（独立的图所在段落、表格）的编号；没有图注 / 标题的不编号。
    pub fn of(&self, block: &Block) -> Option<&ElementTarget> {
        self.by_block.get(&(block as *const Block as usize))
    }

    /// 引用的目标；不存在（或没有编号）时为 None。
    pub fn get(&self, kind: ElementKind, id: &str) -> Option<&ElementTarget> {
        self.by_id.get(&(kind, id.to_owned()))
    }
}

fn walk(blocks: &[Block], visit: &mut dyn FnMut(&Block, ElementKind, Option<&str>)) {
    for block in blocks {
        if let Some((_, alt, id)) = block.figure() {
            if !alt.trim().is_empty() {
                visit(block, ElementKind::Figure, id);
            }
            continue;
        }
        match block {
            Block::Table { caption: Some(caption), .. } if !caption.text.is_empty() => {
                visit(block, ElementKind::Table, caption.id.as_deref())
            }
            Block::List { items, .. } => items.iter().for_each(|item| walk(item, visit)),
            Block::Quote(children) => walk(children, visit),
            _ => {}
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::render::{build, RenderChapter, RenderRequest};

    fn chapter(id: &str, number: Vec<u32>, markdown: &str) -> RenderChapter {
        RenderChapter { id: id.into(), number, title: id.into(), markdown: markdown.into() }
    }

    #[test]
    fn numbered_by_top_level_chapter_in_reading_order() {
        let document = build(&RenderRequest {
            chapters: vec![
                chapter("a", vec![1], "![甲](a.png \"fig:f1\")\n\n![](无图注.png)\n\nTable: 表一 {#tbl:t1}\n\n| x |\n| - |"),
                chapter("a1", vec![1, 1], "> ![乙](b.png)\n\n- ![丙](c.png \"fig:f3\")"),
                chapter("b", vec![2], "![丁](d.png \"fig:f4\")\n\nTable: 表二\n\n| y |\n| - |"),
            ],
            ..Default::default()
        });
        let targets = ElementTargets::new(&document);
        let label = |kind, id| targets.get(kind, id).map(|t| t.label.clone());
        assert_eq!(label(ElementKind::Figure, "f1").as_deref(), Some("图 1-1"));
        assert_eq!(label(ElementKind::Figure, "f3").as_deref(), Some("图 1-3"));
        assert_eq!(label(ElementKind::Figure, "f4").as_deref(), Some("图 2-1"));
        assert_eq!(label(ElementKind::Table, "t1").as_deref(), Some("表 1-1"));
        assert_eq!(targets.get(ElementKind::Figure, "t1"), None);
        let table = document.sections[2].blocks.iter().find(|b| matches!(b, Block::Table { .. })).unwrap();
        assert_eq!(targets.of(table).map(|t| t.label.as_str()), Some("表 2-1"));
        assert_eq!(targets.get(ElementKind::Figure, "f4").unwrap().section, 2);
        // 没有图注的图片不编号。
        assert!(targets.of(&document.sections[0].blocks[1]).is_none());
    }
}
