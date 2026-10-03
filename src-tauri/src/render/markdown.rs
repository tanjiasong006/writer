//! Markdown → 块 / 行内模型。Word、PDF 共用这一份解析结果，保证两者结构一致；
//! 与编辑器（另一套实现）的一致性由共享语义 fixture 约束（docs/decisions.md 第 8 节）。
//!
//! 正文不支持标题与 HTML（docs/decisions.md 第 8 节），与编辑器的方言一致：
//! 原始 HTML 一律作为普通文本；Markdown 标题作为普通段落，文字是标题的原文（见 HeadingsAsText）。

use std::cell::RefCell;
use std::collections::{HashMap, VecDeque};
use std::iter::Peekable;

use pulldown_cmark::{Alignment, CodeBlockKind, Event, OffsetIter, Options, Parser, Tag, TagEnd};

use super::chapter_reference::{parse_address, Address, ElementKind, RefTarget};

#[derive(Debug, Clone, PartialEq)]
pub enum Block {
    Paragraph(Vec<Inline>),
    List {
        ordered: bool,
        start: u64,
        items: Vec<Vec<Block>>,
    },
    Quote(Vec<Block>),
    Code {
        language: Option<String>,
        text: String,
    },
    Table {
        alignments: Vec<Align>,
        header: Vec<Vec<Inline>>,
        rows: Vec<Vec<Vec<Inline>>>,
        /// 表格标题：紧接在表格之前、原文以 `Table: ` 开头的段落（docs/decisions.md 第 12 节）。
        caption: Option<Caption>,
    },
    Rule,
}

/// 表格标题：文字与可选的标识（`{#tbl:<id>}`）。
#[derive(Debug, Clone, PartialEq)]
pub struct Caption {
    pub text: String,
    pub id: Option<String>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Align {
    None,
    Left,
    Center,
    Right,
}

#[derive(Debug, Clone, PartialEq)]
pub enum Inline {
    Text(String),
    Strong(Vec<Inline>),
    Emphasis(Vec<Inline>),
    Strike(Vec<Inline>),
    Code(String),
    Link {
        url: String,
        children: Vec<Inline>,
    },
    /// 章节交叉引用（docs/decisions.md 第 9 节）：地址以 `writer:` 开头的链接。
    /// target 为 None 表示地址格式错误；cached 是链接文字（缓存），只在目标失效时使用。
    ChapterRef {
        target: Option<RefTarget>,
        cached: String,
    },
    /// src 为正文中的原始引用（如 ../assets/图.png），由各渲染器自行解析。
    /// id 是独立成段的图被引用时的标识：图片 title 为 `fig:<id>`（docs/decisions.md 第 12 节）。
    Image {
        src: String,
        alt: String,
        id: Option<String>,
    },
    /// 文献引用（`writer:cite/<id>`）；cached 是链接文字，只在条目不存在时使用。
    Citation {
        id: String,
        cached: String,
    },
    /// 图表引用（`writer:figure/<id>`、`writer:table/<id>`）；cached 是链接文字，只在目标失效时使用。
    ElementRef {
        kind: ElementKind,
        id: String,
        cached: String,
    },
    /// 公式（`$…$` 行内、`$$…$$` 行间，内容是 LaTeX，docs/decisions.md 第 14 节）。
    /// 段落中只有一个行间公式时是独立的公式块（`Block::as_math`）。
    Math {
        tex: String,
        display: bool,
    },
    /// 脚注（GFM `[^label]`）：内容是定义的行内文字（多段以空格连接），出现在引用处。
    /// 同一定义被引用多次时每个引用各是一条脚注（与编辑器相同）。
    Footnote(Vec<Inline>),
    SoftBreak,
    HardBreak,
}

impl Block {
    /// 只含一张图片的段落，渲染为独立的图（居中、限宽）。
    pub fn as_figure(&self) -> Option<(&str, &str)> {
        self.figure().map(|(src, alt, _)| (src, alt))
    }

    /// 只含一个行间公式的段落：独立的公式块（居中），返回 LaTeX 原文（去掉首尾空白）。
    pub fn as_math(&self) -> Option<&str> {
        match self {
            Block::Paragraph(inlines) => match inlines.as_slice() {
                [Inline::Math { tex, display: true }] => Some(tex.trim()),
                _ => None,
            },
            _ => None,
        }
    }

    /// 独立的图：地址、图注与标识。
    pub fn figure(&self) -> Option<(&str, &str, Option<&str>)> {
        match self {
            Block::Paragraph(inlines) => match inlines.as_slice() {
                [Inline::Image { src, alt, id }] => Some((src, alt, id.as_deref())),
                _ => None,
            },
            _ => None,
        }
    }
}

/// 引用 / 列表的最大嵌套层数。更深的内容压平为文本，保证解析与各渲染器的递归深度有上界。
const MAX_NESTING: usize = 32;

thread_local! {
    /// 解析一章时收集的脚注定义（标签小写 → 内容）。定义可能出现在引用之后，解析完再把引用换成内容。
    static FOOTNOTES: RefCell<HashMap<String, Vec<Inline>>> = RefCell::new(HashMap::new());
}

thread_local! {
    /// 按顺序记录每个段落的原文是否以 `Table: ` 开头（由 HeadingsAsText 在产生段落开始时记下）。
    static CAPTION_CANDIDATES: RefCell<VecDeque<bool>> = const { RefCell::new(VecDeque::new()) };
}

const CAPTION_PREFIX: &str = "Table: ";

/// 表格标题段落 → 标题：去掉 `Table: `，结尾的 `{#tbl:<id>}` 是标识。
fn table_caption(inlines: &[Inline]) -> Caption {
    let text = plain_text(inlines);
    let text = text.trim().strip_prefix(CAPTION_PREFIX.trim_end()).unwrap_or(&text).trim();
    if let Some(start) = text.rfind("{#tbl:") {
        let id = &text[start + "{#tbl:".len()..];
        if let Some(id) = id.strip_suffix('}') {
            if !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_') {
                return Caption {
                    text: text[..start].trim_end().to_owned(),
                    id: Some(id.to_owned()),
                };
            }
        }
    }
    Caption { text: text.to_owned(), id: None }
}

/// 引用处的占位：解析完成后由 resolve_footnotes 换成 Footnote（有定义）或文字（没有定义）。
const FOOTNOTE_MARK: char = '\u{0}';

pub fn parse(markdown: &str) -> Vec<Block> {
    let options = Options::ENABLE_TABLES
        | Options::ENABLE_STRIKETHROUGH
        | Options::ENABLE_TASKLISTS
        | Options::ENABLE_FOOTNOTES
        | Options::ENABLE_MATH;
    let mut events = HeadingsAsText {
        source: markdown,
        inner: Parser::new_ext(markdown, options).into_offset_iter(),
        queued: VecDeque::new(),
    }
    .peekable();
    FOOTNOTES.with(|footnotes| footnotes.borrow_mut().clear());
    CAPTION_CANDIDATES.with(|queue| queue.borrow_mut().clear());
    let mut parsed = blocks(&mut events, &|_| false, 0);
    let definitions = FOOTNOTES.with(|footnotes| std::mem::take(&mut *footnotes.borrow_mut()));
    for block in &mut parsed {
        resolve_block(block, &definitions);
    }
    parsed
}

fn resolve_block(block: &mut Block, definitions: &HashMap<String, Vec<Inline>>) {
    match block {
        Block::Paragraph(inlines) => resolve_inlines(inlines, definitions),
        Block::List { items, .. } => items
            .iter_mut()
            .flatten()
            .for_each(|block| resolve_block(block, definitions)),
        Block::Quote(blocks) => blocks
            .iter_mut()
            .for_each(|block| resolve_block(block, definitions)),
        Block::Table { header, rows, .. } => header
            .iter_mut()
            .chain(rows.iter_mut().flatten())
            .for_each(|cell| resolve_inlines(cell, definitions)),
        Block::Code { .. } | Block::Rule => {}
    }
}

fn resolve_inlines(inlines: &mut Vec<Inline>, definitions: &HashMap<String, Vec<Inline>>) {
    for inline in inlines.iter_mut() {
        match inline {
            Inline::Footnote(marker) => {
                let label = match marker.as_slice() {
                    [Inline::Text(text)] => text.trim_start_matches(FOOTNOTE_MARK).to_owned(),
                    _ => continue,
                };
                *inline = match definitions.get(&label.to_lowercase()) {
                    Some(content) => Inline::Footnote(content.clone()),
                    None => Inline::Text(format!("[^{label}]")),
                };
            }
            Inline::Strong(children)
            | Inline::Emphasis(children)
            | Inline::Strike(children)
            | Inline::Link { children, .. } => resolve_inlines(children, definitions),
            _ => {}
        }
    }
    *inlines = normalize(std::mem::take(inlines));
}

/// 脚注定义的块 → 行内内容：各块的内容以空格连接；定义中再引用的脚注不保留（与编辑器相同）。
fn footnote_content(blocks: Vec<Block>) -> Vec<Inline> {
    let mut out: Vec<Inline> = Vec::new();
    for block in blocks {
        let inlines = match block {
            Block::Paragraph(inlines) => inlines,
            Block::Code { text, .. } => vec![Inline::Text(text)],
            other => vec![Inline::Text(block_text(&other))],
        };
        if !out.is_empty() {
            out.push(Inline::Text(" ".to_owned()));
        }
        out.extend(inlines.into_iter().filter(|inline| !matches!(inline, Inline::Footnote(_))));
    }
    normalize(out)
}

fn block_text(block: &Block) -> String {
    match block {
        Block::Paragraph(inlines) => plain_text(inlines),
        Block::List { items, .. } => items.iter().flatten().map(block_text).collect::<Vec<_>>().join(" "),
        Block::Quote(blocks) => blocks.iter().map(block_text).collect::<Vec<_>>().join(" "),
        Block::Code { text, .. } => text.clone(),
        Block::Table { header, rows, .. } => header
            .iter()
            .chain(rows.iter().flatten())
            .map(|cell| plain_text(cell))
            .collect::<Vec<_>>()
            .join(" "),
        Block::Rule => String::new(),
    }
}

type Events<'a> = Peekable<HeadingsAsText<'a>>;

/// 把标题换成普通段落：文字是标题的原文（如“## 研究背景”），其中的强调、链接等记号也只是文字。
/// 块的边界仍按 Markdown 标题判断，与编辑器（ui/editor/markdown.ts 的 writer_heading_as_text）一致。
struct HeadingsAsText<'a> {
    source: &'a str,
    inner: OffsetIter<'a>,
    queued: VecDeque<Event<'a>>,
}

impl<'a> Iterator for HeadingsAsText<'a> {
    type Item = Event<'a>;

    fn next(&mut self) -> Option<Event<'a>> {
        if let Some(event) = self.queued.pop_front() {
            return Some(event);
        }
        let (event, range) = self.inner.next()?;
        if matches!(event, Event::Start(Tag::Paragraph)) {
            // 表格标题按原文判断（`Table\: …` 转义后不是标题）。
            let candidate = self.source[range.clone()].trim_start().starts_with(CAPTION_PREFIX);
            CAPTION_CANDIDATES.with(|queue| queue.borrow_mut().push_back(candidate));
        }
        if !matches!(event, Event::Start(Tag::Heading { .. })) {
            return Some(event);
        }
        for (event, _) in self.inner.by_ref() {
            if matches!(event, Event::End(TagEnd::Heading(_))) {
                break;
            }
        }
        for (index, line) in heading_text(&self.source[range]).into_iter().enumerate() {
            if index > 0 {
                self.queued.push_back(Event::SoftBreak);
            }
            self.queued.push_back(Event::Text(line.into()));
        }
        self.queued.push_back(Event::End(TagEnd::Paragraph));
        CAPTION_CANDIDATES.with(|queue| queue.borrow_mut().push_back(false));
        Some(Event::Start(Tag::Paragraph))
    }
}

/// 标题原文的各行（之间是软换行）。ATX 标题是“#… 内容”（去掉结尾的 # 序列），
/// Setext 标题是内容各行加下划线；每行去掉行首的空白与引用记号、行尾的空白。
fn heading_text(raw: &str) -> Vec<String> {
    let lines: Vec<&str> = raw.lines().collect();
    let first = lines.first().copied().unwrap_or("").trim_start();
    if let Some(line) = atx_heading_text(first) {
        return vec![line];
    }
    lines
        .iter()
        .map(|line| {
            line.trim_start_matches(|c: char| c.is_whitespace() || c == '>')
                .trim_end()
                .to_owned()
        })
        .collect()
}

fn atx_heading_text(line: &str) -> Option<String> {
    let hashes = line.chars().take_while(|&c| c == '#').count();
    let rest = &line[hashes..];
    if !(1..=6).contains(&hashes) || !(rest.is_empty() || rest.starts_with([' ', '\t'])) {
        return None;
    }
    let mut content = rest.trim();
    let without_closing = content.trim_end_matches('#');
    if without_closing.len() != content.len()
        && (without_closing.is_empty() || without_closing.ends_with([' ', '\t']))
    {
        content = without_closing.trim_end();
    }
    let marker = &line[..hashes];
    Some(if content.is_empty() {
        marker.to_owned()
    } else {
        format!("{marker} {content}")
    })
}

/// 读取块，直到遇到满足 stop 的结束标记（该标记被消费）。
/// 紧凑列表项中的行内内容没有 Paragraph 包裹，这里把连续的行内事件收成一个段落。
fn blocks(events: &mut Events, stop: &dyn Fn(&TagEnd) -> bool, depth: usize) -> Vec<Block> {
    let mut out = Vec::new();
    let mut pending: Vec<Inline> = Vec::new();
    // 原文以 `Table: ` 开头的段落的位置：紧接着（之间没有其他块）是表格时成为表格的标题。
    let mut caption_at: Option<usize> = None;
    let flush = |pending: &mut Vec<Inline>, out: &mut Vec<Block>| {
        if !pending.is_empty() {
            out.push(Block::Paragraph(normalize(std::mem::take(pending))));
        }
    };

    while let Some(event) = events.next() {
        match event {
            Event::End(end) if stop(&end) => break,
            Event::Start(Tag::Paragraph) => {
                flush(&mut pending, &mut out);
                let candidate = CAPTION_CANDIDATES.with(|queue| queue.borrow_mut().pop_front()).unwrap_or(false);
                out.push(Block::Paragraph(inlines(events, TagEnd::Paragraph)));
                caption_at = candidate.then_some(out.len() - 1);
            }
            Event::Start(Tag::BlockQuote(_) | Tag::List(_)) if depth >= MAX_NESTING => {
                flush(&mut pending, &mut out);
                out.push(Block::Paragraph(vec![Inline::Text(flatten(events))]));
            }
            Event::Start(Tag::BlockQuote(_)) => {
                flush(&mut pending, &mut out);
                out.push(Block::Quote(blocks(
                    events,
                    &|e| matches!(e, TagEnd::BlockQuote(_)),
                    depth + 1,
                )));
            }
            Event::Start(Tag::CodeBlock(kind)) => {
                flush(&mut pending, &mut out);
                let language = match kind {
                    CodeBlockKind::Fenced(info) => {
                        info.split_whitespace().next().map(str::to_owned)
                    }
                    CodeBlockKind::Indented => None,
                };
                let mut text = raw_text(events, TagEnd::CodeBlock);
                if text.ends_with('\n') {
                    text.pop();
                }
                out.push(Block::Code { language, text });
            }
            Event::Start(Tag::HtmlBlock) => {
                flush(&mut pending, &mut out);
                let text = raw_text(events, TagEnd::HtmlBlock);
                out.push(Block::Paragraph(vec![Inline::Text(
                    text.trim_end().to_owned(),
                )]));
            }
            Event::Start(Tag::List(start)) => {
                flush(&mut pending, &mut out);
                out.push(list(events, start, depth + 1));
            }
            Event::Start(Tag::Table(alignments)) => {
                flush(&mut pending, &mut out);
                let mut block = table(events, &alignments);
                if let (Some(index), Block::Table { caption, .. }) = (caption_at.take(), &mut block) {
                    if index + 1 == out.len() {
                        if let Block::Paragraph(inlines) = out.remove(index) {
                            *caption = Some(table_caption(&inlines));
                        }
                    }
                }
                out.push(block);
            }
            Event::Rule => {
                flush(&mut pending, &mut out);
                out.push(Block::Rule);
            }
            Event::Start(Tag::FootnoteDefinition(label)) => {
                // 定义不是正文中的块：内容记下来，出现在引用它的地方。重复定义以第一个为准。
                flush(&mut pending, &mut out);
                let content = footnote_content(blocks(
                    events,
                    &|e| matches!(e, TagEnd::FootnoteDefinition),
                    depth + 1,
                ));
                FOOTNOTES.with(|footnotes| {
                    footnotes
                        .borrow_mut()
                        .entry(label.to_lowercase())
                        .or_insert(content);
                });
            }
            Event::Start(tag) => {
                if let Some(inline) = inline_from_start(tag, events) {
                    pending.push(inline);
                }
            }
            other => {
                if let Some(inline) = inline_from_leaf(other) {
                    pending.push(inline);
                }
            }
        }
    }
    flush(&mut pending, &mut out);
    out
}

fn list(events: &mut Events, start: Option<u64>, depth: usize) -> Block {
    let mut items = Vec::new();
    while let Some(event) = events.next() {
        match event {
            Event::Start(Tag::Item) => {
                items.push(blocks(events, &|e| matches!(e, TagEnd::Item), depth));
            }
            Event::End(TagEnd::List(_)) => break,
            _ => {}
        }
    }
    Block::List {
        ordered: start.is_some(),
        start: start.unwrap_or(1),
        items,
    }
}

fn table(events: &mut Events, alignments: &[Alignment]) -> Block {
    let alignments = alignments
        .iter()
        .map(|a| match a {
            Alignment::None => Align::None,
            Alignment::Left => Align::Left,
            Alignment::Center => Align::Center,
            Alignment::Right => Align::Right,
        })
        .collect();
    let mut header = Vec::new();
    let mut rows = Vec::new();
    let mut row: Vec<Vec<Inline>> = Vec::new();
    let mut in_head = false;
    while let Some(event) = events.next() {
        match event {
            Event::Start(Tag::TableHead) => in_head = true,
            Event::End(TagEnd::TableHead) => {
                in_head = false;
                header = std::mem::take(&mut row);
            }
            Event::Start(Tag::TableCell) => row.push(inlines(events, TagEnd::TableCell)),
            Event::End(TagEnd::TableRow) if !in_head => rows.push(std::mem::take(&mut row)),
            Event::End(TagEnd::Table) => break,
            _ => {}
        }
    }
    Block::Table {
        alignments,
        header,
        rows,
        caption: None,
    }
}

/// 读取行内内容直到指定结束标记。
fn inlines(events: &mut Events, end: TagEnd) -> Vec<Inline> {
    let mut out = Vec::new();
    while let Some(event) = events.next() {
        match event {
            Event::End(e) if e == end => break,
            Event::Start(tag) => {
                if let Some(inline) = inline_from_start(tag, events) {
                    out.push(inline);
                }
            }
            other => {
                if let Some(inline) = inline_from_leaf(other) {
                    out.push(inline);
                }
            }
        }
    }
    normalize(out)
}

fn inline_from_start(tag: Tag, events: &mut Events) -> Option<Inline> {
    Some(match tag {
        Tag::Emphasis => Inline::Emphasis(inlines(events, TagEnd::Emphasis)),
        Tag::Strong => Inline::Strong(inlines(events, TagEnd::Strong)),
        Tag::Strikethrough => Inline::Strike(inlines(events, TagEnd::Strikethrough)),
        Tag::Link { dest_url, .. } => {
            let children = inlines(events, TagEnd::Link);
            match parse_address(&dest_url) {
                Address::Link => Inline::Link {
                    url: dest_url.into_string(),
                    children,
                },
                Address::Malformed => Inline::ChapterRef {
                    target: None,
                    cached: plain_text(&children),
                },
                Address::Cite(id) => Inline::Citation {
                    id,
                    cached: plain_text(&children),
                },
                Address::Element(kind, id) => Inline::ElementRef {
                    kind,
                    id,
                    cached: plain_text(&children),
                },
                Address::Ref(target) => Inline::ChapterRef {
                    target: Some(target),
                    cached: plain_text(&children),
                },
            }
        }
        Tag::Image { dest_url, title, .. } => Inline::Image {
            src: dest_url.into_string(),
            alt: plain_text(&inlines(events, TagEnd::Image)),
            id: title
                .strip_prefix("fig:")
                .filter(|id| !id.is_empty() && id.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_'))
                .map(str::to_owned),
        },
        other => {
            // 未启用的扩展（上下标等）：保留其中的文字。
            let end = other.to_end();
            return Some(Inline::Text(plain_text(&inlines(events, end))));
        }
    })
}

fn inline_from_leaf(event: Event) -> Option<Inline> {
    Some(match event {
        Event::Text(text) | Event::Html(text) | Event::InlineHtml(text) => {
            Inline::Text(text.into_string())
        }
        Event::Code(code) => Inline::Code(code.into_string()),
        Event::InlineMath(tex) => Inline::Math {
            tex: tex.into_string(),
            display: false,
        },
        Event::DisplayMath(tex) => Inline::Math {
            tex: tex.into_string(),
            display: true,
        },
        Event::SoftBreak => Inline::SoftBreak,
        Event::HardBreak => Inline::HardBreak,
        Event::TaskListMarker(done) => Inline::Text(if done { "☑ " } else { "☐ " }.to_owned()),
        Event::FootnoteReference(name) => {
            Inline::Footnote(vec![Inline::Text(format!("{FOOTNOTE_MARK}{name}"))])
        }
        _ => return None,
    })
}

/// 迭代地消费一个已开始的容器直到它结束，只保留文字。用于超过嵌套上限的内容。
fn flatten(events: &mut Events) -> String {
    let mut open = 1usize;
    let mut text = String::new();
    for event in events.by_ref() {
        match event {
            Event::Start(_) => open += 1,
            Event::End(_) => {
                open -= 1;
                if open == 0 {
                    break;
                }
            }
            Event::Text(t) | Event::Code(t) | Event::Html(t) | Event::InlineHtml(t) => {
                if !text.is_empty() && !text.ends_with(' ') {
                    text.push(' ');
                }
                text.push_str(&t);
            }
            _ => {}
        }
    }
    text
}

fn raw_text(events: &mut Events, end: TagEnd) -> String {
    let mut text = String::new();
    for event in events.by_ref() {
        match event {
            Event::End(e) if e == end => break,
            Event::Text(t) | Event::Html(t) => text.push_str(&t),
            _ => {}
        }
    }
    text
}

/// 合并相邻文本（pulldown-cmark 会在特殊字符处拆分文本），并去掉中文字符之间的软换行：
/// 软换行按 CommonMark 渲染为空格，中文在编辑器里折行后会凭空多出空格。
fn normalize(inlines: Vec<Inline>) -> Vec<Inline> {
    let mut out: Vec<Inline> = Vec::with_capacity(inlines.len());
    let mut iter = inlines.into_iter().peekable();
    while let Some(inline) = iter.next() {
        if inline == Inline::SoftBreak {
            let before = match out.last() {
                Some(Inline::Text(text)) => text.chars().last(),
                _ => None,
            };
            let after = match iter.peek() {
                Some(Inline::Text(text)) => text.chars().next(),
                _ => None,
            };
            if before.is_some_and(is_cjk) && after.is_some_and(is_cjk) {
                continue;
            }
        }
        match (out.last_mut(), inline) {
            (Some(Inline::Text(previous)), Inline::Text(text)) => previous.push_str(&text),
            (_, inline) => out.push(inline),
        }
    }
    out
}

/// 中日韩文字与全角标点：它们之间的换行不应变成空格。
fn is_cjk(c: char) -> bool {
    matches!(c,
        '\u{2E80}'..='\u{2FFF}'   // 部首
        | '\u{3000}'..='\u{303F}' // 中文标点
        | '\u{3040}'..='\u{30FF}' // 假名
        | '\u{3400}'..='\u{4DBF}' // 扩展 A
        | '\u{4E00}'..='\u{9FFF}' // 基本汉字
        | '\u{AC00}'..='\u{D7AF}' // 韩文
        | '\u{F900}'..='\u{FAFF}' // 兼容汉字
        | '\u{FF00}'..='\u{FFEF}' // 全角形式
        | '\u{20000}'..='\u{2FA1F}')
}

/// 行内内容的纯文本（用于图片 alt 等）。
pub fn plain_text(inlines: &[Inline]) -> String {
    let mut text = String::new();
    for inline in inlines {
        match inline {
            Inline::Text(t) | Inline::Code(t) => text.push_str(t),
            Inline::Math { tex, .. } => text.push_str(tex),
            Inline::Strong(c) | Inline::Emphasis(c) | Inline::Strike(c) => {
                text.push_str(&plain_text(c))
            }
            Inline::Link { children, .. } => text.push_str(&plain_text(children)),
            Inline::Image { alt, .. } => text.push_str(alt),
            Inline::ChapterRef { cached, .. }
            | Inline::ElementRef { cached, .. }
            | Inline::Citation { cached, .. } => text.push_str(cached),
            Inline::Footnote(_) => {}
            Inline::SoftBreak | Inline::HardBreak => text.push(' '),
        }
    }
    text
}

#[cfg(test)]
mod tests {
    use super::*;

    fn text(s: &str) -> Inline {
        Inline::Text(s.to_owned())
    }

    #[test]
    fn paragraphs_and_inline_styles() {
        assert_eq!(
            parse("普通**加粗**与*斜体*、~~删除~~、`代码`。\n\n第二段"),
            vec![
                Block::Paragraph(vec![
                    text("普通"),
                    Inline::Strong(vec![text("加粗")]),
                    text("与"),
                    Inline::Emphasis(vec![text("斜体")]),
                    text("、"),
                    Inline::Strike(vec![text("删除")]),
                    text("、"),
                    Inline::Code("代码".into()),
                    text("。"),
                ]),
                Block::Paragraph(vec![text("第二段")]),
            ]
        );
    }

    #[test]
    fn headings_are_plain_paragraphs_quotes_rules() {
        assert_eq!(
            parse("## 小节\n\n> 引用\n\n---"),
            vec![
                Block::Paragraph(vec![text("## 小节")]),
                Block::Quote(vec![Block::Paragraph(vec![text("引用")])]),
                Block::Rule,
            ]
        );
    }

    #[test]
    fn heading_source_is_kept_as_text() {
        // 强调记号只是文字；结尾的 # 序列按 CommonMark 去掉；标题仍会打断段落。
        assert_eq!(
            parse("## 二级 **强调** 标题 ##\n段落\n# 打断\n\n#\n\n####### 七个井号"),
            vec![
                Block::Paragraph(vec![text("## 二级 **强调** 标题")]),
                Block::Paragraph(vec![text("段落")]),
                Block::Paragraph(vec![text("# 打断")]),
                Block::Paragraph(vec![text("#")]),
                Block::Paragraph(vec![text("####### 七个井号")]),
            ]
        );
        // Setext 标题：内容各行与下划线之间是软换行（中文之间不留空格）。
        assert_eq!(
            parse("标题\n===\n\n> Title\n> ---\n\n- 列表中\n  ---"),
            vec![
                Block::Paragraph(vec![text("标题"), Inline::SoftBreak, text("===")]),
                Block::Quote(vec![Block::Paragraph(vec![
                    text("Title"),
                    Inline::SoftBreak,
                    text("---")
                ])]),
                Block::List {
                    ordered: false,
                    start: 1,
                    items: vec![vec![Block::Paragraph(vec![
                        text("列表中"),
                        Inline::SoftBreak,
                        text("---")
                    ])]],
                },
            ]
        );
    }

    #[test]
    fn tight_and_nested_lists() {
        assert_eq!(
            parse("- 甲\n  1. 子项\n- 乙"),
            vec![Block::List {
                ordered: false,
                start: 1,
                items: vec![
                    vec![
                        Block::Paragraph(vec![text("甲")]),
                        Block::List {
                            ordered: true,
                            start: 1,
                            items: vec![vec![Block::Paragraph(vec![text("子项")])]],
                        },
                    ],
                    vec![Block::Paragraph(vec![text("乙")])],
                ],
            }]
        );
        assert!(matches!(
            parse("3. 从三开始")[0],
            Block::List {
                ordered: true,
                start: 3,
                ..
            }
        ));
    }

    #[test]
    fn code_blocks_keep_text_verbatim() {
        assert_eq!(
            parse("```rust\nfn main() {}\n  <b>\n```"),
            vec![Block::Code {
                language: Some("rust".into()),
                text: "fn main() {}\n  <b>".into()
            }]
        );
    }

    #[test]
    fn tables_with_alignment() {
        let blocks = parse("| 组别 | 数 |\n| :-- | --: |\n| 对照 | 30 |\n| 实验 | **32** |");
        assert_eq!(
            blocks,
            vec![Block::Table {
                alignments: vec![Align::Left, Align::Right],
                header: vec![vec![text("组别")], vec![text("数")]],
                rows: vec![
                    vec![vec![text("对照")], vec![text("30")]],
                    vec![vec![text("实验")], vec![Inline::Strong(vec![text("32")])]],
                ],
                caption: None,
            }]
        );
    }

    #[test]
    fn table_caption_is_the_paragraph_before_the_table_in_the_source() {
        let caption = |markdown: &str| match parse(markdown).last() {
            Some(Block::Table { caption, .. }) => caption.clone(),
            _ => None,
        };
        assert_eq!(
            caption("Table: 样本 *构成* {#tbl:t1}\n\n| a |\n| - |"),
            Some(Caption { text: "样本 构成".into(), id: Some("t1".into()) })
        );
        assert_eq!(caption("Table: 无标识\n\n| a |\n| - |"), Some(Caption { text: "无标识".into(), id: None }));
        // 转义后不是标题；之间隔着其他块、或标题段落后面不是表格时，段落保留。
        assert_eq!(caption("Table\\: 文字\n\n| a |\n| - |"), None);
        assert_eq!(caption("Table: 甲\n\n---\n\n| a |\n| - |"), None);
        assert_eq!(parse("Table: 只是文字").len(), 1);
        // 标题不在正文中重复出现。
        assert_eq!(parse("Table: 甲\n\n| a |\n| - |").len(), 1);
    }

    #[test]
    fn math_inline_and_display() {
        let blocks = parse("面积 $\\pi r^2$ 与 $$E=mc^2$$。\n\n$$\n\\int_0^1 x\\,dx\n$$\n\n价格 $5 与 $ 6$ 不是公式");
        assert_eq!(
            blocks[0],
            Block::Paragraph(vec![
                text("面积 "),
                Inline::Math { tex: "\\pi r^2".into(), display: false },
                text(" 与 "),
                Inline::Math { tex: "E=mc^2".into(), display: true },
                text("。"),
            ])
        );
        assert_eq!(blocks[1].as_math(), Some("\\int_0^1 x\\,dx"));
        assert_eq!(blocks[2], Block::Paragraph(vec![text("价格 $5 与 $ 6$ 不是公式")]));
    }

    #[test]
    fn figure_id_comes_from_the_title() {
        assert_eq!(parse("![图注](a.png \"fig:f1\")")[0].figure(), Some(("a.png", "图注", Some("f1"))));
        assert_eq!(parse("![图注](a.png \"其他标题\")")[0].figure(), Some(("a.png", "图注", None)));
    }

    #[test]
    fn standalone_image_is_a_figure() {
        let blocks = parse("![实验 装置](../assets/图.png)");
        assert_eq!(
            blocks[0].as_figure(),
            Some(("../assets/图.png", "实验 装置"))
        );
        assert_eq!(parse("文字 ![a](b.png)")[0].as_figure(), None);
    }

    #[test]
    fn raw_html_is_plain_text() {
        assert_eq!(
            parse("<script>alert(1)</script>\n\n行内 <b>粗</b>"),
            vec![
                Block::Paragraph(vec![text("<script>alert(1)</script>")]),
                Block::Paragraph(vec![text("行内 <b>粗</b>")]),
            ]
        );
    }

    #[test]
    fn task_lists_and_links() {
        assert_eq!(
            parse("- [x] 完成\n\n[官网](https://example.com)"),
            vec![
                Block::List {
                    ordered: false,
                    start: 1,
                    items: vec![vec![Block::Paragraph(vec![text("☑ 完成")])]],
                },
                Block::Paragraph(vec![Inline::Link {
                    url: "https://example.com".into(),
                    children: vec![text("官网")],
                }]),
            ]
        );
    }

    #[test]
    fn pathological_nesting_does_not_overflow() {
        let quotes = format!("{} 深处", ">".repeat(10_000));
        let blocks = parse(&quotes);
        let mut depth = 0;
        let mut current = &blocks;
        while let [Block::Quote(inner)] = current.as_slice() {
            depth += 1;
            current = inner;
        }
        assert_eq!(depth, MAX_NESTING);
        assert_eq!(current, &vec![Block::Paragraph(vec![text("深处")])]);

        let lists: String = (0..5_000)
            .map(|i| format!("{}- 项\n", "  ".repeat(i)))
            .collect();
        assert!(!parse(&lists).is_empty());
    }

    #[test]
    fn soft_breaks_between_chinese_disappear() {
        assert_eq!(
            parse("第一行\n第二行，"),
            vec![Block::Paragraph(vec![text("第一行第二行，")])]
        );
        assert_eq!(
            parse("English\nwords"),
            vec![Block::Paragraph(vec![
                text("English"),
                Inline::SoftBreak,
                text("words")
            ])]
        );
        assert_eq!(
            parse("中文\nEnglish"),
            vec![Block::Paragraph(vec![
                text("中文"),
                Inline::SoftBreak,
                text("English")
            ])]
        );
    }

    #[test]
    fn empty_input() {
        assert_eq!(parse(""), vec![]);
        assert_eq!(parse("\n\n  \n"), vec![]);
    }
}
