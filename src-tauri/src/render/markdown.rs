//! Markdown → 块 / 行内模型。Word、PDF 共用这一份解析结果，保证两者结构一致；
//! 与编辑器（另一套实现）的一致性由共享语义 fixture 约束（docs/decisions.md 第 8 节）。
//!
//! 正文不支持标题与 HTML（docs/decisions.md 第 8 节），与编辑器的方言一致：
//! 原始 HTML 一律作为普通文本（唯一的例外是上下标标签，见 InlineRun）；Markdown 标题作为普通段落，
//! 文字是标题的原文（见 HeadingsAsText）。

use std::cell::{Cell, RefCell};
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
        /// 有序列表的编号样式：紧挨在列表之前的 `<!-- writer:list <样式> -->`（docs/decisions.md 第 24 节）。
        /// 无序列表与没有样式注释的有序列表是默认的 `1.`。
        numbering: ListNumbering,
        items: Vec<Vec<Block>>,
    },
    Quote(Vec<Block>),
    Code {
        language: Option<String>,
        text: String,
    },
    /// 化学结构式（docs/decisions.md 第 22 节）：语言为 `smiles` 的围栏代码块，smiles 是去掉首尾空白的内容；
    /// 反应式的箭头与条件来自代码块信息（`StructureConditions`）。图片由前端画好随请求传入（`render::Document::structures`）。
    Structure {
        smiles: String,
        conditions: StructureConditions,
    },
    Table {
        alignments: Vec<Align>,
        /// 表头各行（至少一行）；分隔行之上紧贴着的、以 `|` 开头的各行也是表头（docs/decisions.md 第 23 节）。
        header: Vec<Vec<Vec<Inline>>>,
        rows: Vec<Vec<Vec<Inline>>>,
        /// 合并单元格（docs/decisions.md 第 23 节）。header 与 rows 仍是完整的网格：
        /// 被合并的位置是空单元格，内容在区域左上角的单元格中。
        spans: Vec<CellSpan>,
        /// 表格标题：紧接在表格之前、原文以 `Table: ` 开头的段落（docs/decisions.md 第 12 节）。
        caption: Option<Caption>,
        /// 表注：紧跟在表格之后、原文以 `Table-note: ` 开头的段落的文字（docs/decisions.md 第 12 节）。
        note: Option<String>,
    },
    Rule,
}

/// 有序列表的编号样式（docs/decisions.md 第 24 节），即编号写法本身（与 Typst 的编号写法相同）：
/// 其中的 1 / 一 / ① / I / i / A / a 是计数符号，其余是前后缀。与前端 `domain/list_numbering` 相同。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ListNumbering(&'static str);

impl ListNumbering {
    pub const ALL: [&'static str; 11] = ["1.", "1)", "(1)", "（1）", "一、", "（一）", "①", "I.", "i.", "A.", "a."];
    pub const DEFAULT: Self = Self("1.");

    pub fn parse(text: &str) -> Option<Self> {
        Self::ALL.iter().find(|&&style| style == text).map(|&style| Self(style))
    }

    /// 样式注释：恰好一行 `<!-- writer:list <样式> -->`（首尾、各部分之间的空白只能是空格与制表符），样式是认识的写法。
    /// 与编辑器（ui/editor/markdown.ts 的 LIST_STYLE_COMMENT）相同。
    pub fn from_comment(html: &str) -> Option<Self> {
        let blank = [' ', '\t'];
        let line = html.trim_end_matches(['\n', '\r']).trim_matches(blank);
        let body = line.strip_prefix("<!--")?.strip_suffix("-->")?.trim_matches(blank);
        let rest = body.strip_prefix("writer:list")?;
        if !rest.starts_with(blank) {
            return None;
        }
        Self::parse(rest.trim_matches(blank))
    }

    /// 编号写法，如 `（一）`。
    pub fn pattern(self) -> &'static str {
        self.0
    }

    pub fn is_default(self) -> bool {
        self == Self::DEFAULT
    }
}

/// 合并的单元格区域：row 从表头第一行起算（表头各行之后是正文），区域不跨越表头与正文。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct CellSpan {
    pub row: usize,
    pub col: usize,
    pub rows: usize,
    pub cols: usize,
}

/// 单元格在合并区域中的位置。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CellPlace {
    /// 不属于任何合并区域。
    Single,
    /// 区域的左上角：内容所在的单元格。
    Origin(CellSpan),
    /// 区域中被合并的其他位置。
    Covered(CellSpan),
}

/// 第 row 行（从表头第一行起算）第 col 列的单元格在合并区域中的位置。
pub fn cell_place(spans: &[CellSpan], row: usize, col: usize) -> CellPlace {
    for &span in spans {
        if (span.row..span.row + span.rows).contains(&row) && (span.col..span.col + span.cols).contains(&col) {
            return if span.row == row && span.col == col { CellPlace::Origin(span) } else { CellPlace::Covered(span) };
        }
    }
    CellPlace::Single
}

/// 结构式代码块信息中的属性（docs/decisions.md 第 22 节）：反应式的箭头与条件，分子的方向。
/// arrow 为空是 →，`<=>` 是 ⇌，`=` 是＝。rotate 是顺时针旋转的度数（0–359），flip 是左右翻转（先翻转再旋转）；
/// 方向由前端画进图片，这里只用于对应图片与写回信息。
#[derive(Debug, Clone, Default, PartialEq, Eq, Hash, serde::Deserialize)]
#[serde(default)]
pub struct StructureConditions {
    pub arrow: String,
    pub above: String,
    pub below: String,
    pub rotate: i32,
    pub flip: bool,
}

impl StructureConditions {
    /// 代码块信息中第一个词之后的属性 `key="value"`（值中不含双引号）：认识 arrow、above、below、rotate、flip
    /// （不区分大小写），其他忽略；条件去掉首尾空白；rotate 是整数（可有首尾空白，其他写法是 0），flip 是 true
    /// （不区分大小写）时翻转。与编辑器的 parseStructureInfo 相同。
    pub fn parse(info: &str) -> Self {
        let info = info.trim();
        let rest = &info[info.find(char::is_whitespace).unwrap_or(info.len())..];
        let chars: Vec<char> = rest.chars().collect();
        let mut conditions = StructureConditions::default();
        let mut i = 0;
        while i < chars.len() {
            if !chars[i].is_ascii_alphabetic() {
                i += 1;
                continue;
            }
            let mut j = i;
            while j < chars.len() && chars[j].is_ascii_alphabetic() {
                j += 1;
            }
            let quoted = chars.get(j) == Some(&'=') && chars.get(j + 1) == Some(&'"');
            let close = if quoted { chars[j + 2..].iter().position(|&c| c == '"').map(|k| j + 2 + k) } else { None };
            let Some(close) = close else {
                i += 1;
                continue;
            };
            let key: String = chars[i..j].iter().collect::<String>().to_ascii_lowercase();
            let value: String = chars[j + 2..close].iter().collect();
            match key.as_str() {
                "arrow" => conditions.arrow = normalize_arrow(&value),
                "above" => conditions.above = value.trim().to_owned(),
                "below" => conditions.below = value.trim().to_owned(),
                "rotate" => {
                    let value = value.trim();
                    // 与编辑器相同：可选的负号与数字（parse 还接受 +）。
                    conditions.rotate = if value.starts_with('+') { 0 } else { value.parse::<i64>().map_or(0, normalize_rotate) };
                }
                "flip" => conditions.flip = value.trim().eq_ignore_ascii_case("true"),
                _ => {}
            }
            i = close + 1;
        }
        conditions
    }

    /// 写回代码块信息：`smiles` 与非空的属性（与编辑器写出的相同）。
    pub fn info(&self) -> String {
        let value = |text: &str| {
            text.replace('"', "＂").split_whitespace().collect::<Vec<_>>().join(" ").replace('\\', "\\\\").replace('&', "\\&")
        };
        let mut info = String::from("smiles");
        let arrow = normalize_arrow(&self.arrow);
        if !arrow.is_empty() {
            info.push_str(&format!(" arrow=\"{arrow}\""));
        }
        if !self.above.trim().is_empty() {
            info.push_str(&format!(" above=\"{}\"", value(&self.above)));
        }
        if !self.below.trim().is_empty() {
            info.push_str(&format!(" below=\"{}\"", value(&self.below)));
        }
        let rotate = normalize_rotate(self.rotate.into());
        if rotate != 0 {
            info.push_str(&format!(" rotate=\"{rotate}\""));
        }
        if self.flip {
            info.push_str(" flip=\"true\"");
        }
        info
    }
}

/// 旋转的度数换算到 0–359。
fn normalize_rotate(degrees: i64) -> i32 {
    degrees.rem_euclid(360) as i32
}

/// 箭头：`<=>` 与 `=` 保留，其他（含 `->`）都是 → 并写作空。
fn normalize_arrow(arrow: &str) -> String {
    match arrow.trim() {
        value @ ("<=>" | "=") => value.to_owned(),
        _ => String::new(),
    }
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
    /// 上标 / 下标（`<sup>…</sup>`、`<sub>…</sub>`，docs/decisions.md 第 21 节）。
    /// 其中不再有上下标：嵌套时以外层为准，内层只保留内容。
    Superscript(Vec<Inline>),
    Subscript(Vec<Inline>),
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

/// 段落原文开头的表格记号：`Table: `（表格标题）或 `Table-note: `（表注）。
#[derive(Clone, Copy, PartialEq, Eq)]
enum TableMark {
    None,
    Caption,
    Note,
}

thread_local! {
    /// 按顺序记录每个段落原文开头的表格记号（由 HeadingsAsText 在产生段落开始时记下）。
    static TABLE_MARKS: RefCell<VecDeque<TableMark>> = const { RefCell::new(VecDeque::new()) };
}

thread_local! {
    /// 刚产生的有序列表开始是否紧挨在一个 HTML 块之后（之间没有空行，由 HeadingsAsText 记下）：
    /// 只有这时，HTML 块中的样式注释才是列表的编号样式（与编辑器相同）。
    static LIST_AFTER_HTML: Cell<bool> = const { Cell::new(false) };
}

/// 表格单元格原文中的合并记号（docs/decisions.md 第 23 节），按原文判断：
/// 两个竖线之间没有任何字符（`||`）是与左侧合并，内容恰好是 `^^` 是与上方合并（转义的 `\^^` 是文字）。
#[derive(Clone, Copy, PartialEq, Eq, Debug)]
enum CellMark {
    Plain,
    Left,
    Up,
}

thread_local! {
    /// 按顺序记录每个表格单元格原文的合并记号（由 HeadingsAsText 在产生单元格开始时记下）。
    static CELL_MARKS: RefCell<VecDeque<CellMark>> = const { RefCell::new(VecDeque::new()) };
    /// 按顺序记录每个表格在分隔行之上多出的表头行（见 header_lines），没有时为 None。
    static HEADER_ROWS: RefCell<VecDeque<Option<Vec<String>>>> = const { RefCell::new(VecDeque::new()) };
}

const CAPTION_PREFIX: &str = "Table: ";
const NOTE_PREFIX: &str = "Table-note: ";

/// 表注段落 → 表注的文字：去掉 `Table-note: `。
fn table_note(inlines: &[Inline]) -> String {
    let text = plain_text(inlines);
    let text = text.trim();
    text.strip_prefix(NOTE_PREFIX.trim_end()).unwrap_or(text).trim().to_owned()
}

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
        row_end: 0,
        run: None,
        run_open: false,
        html_end: None,
    }
    .peekable();
    FOOTNOTES.with(|footnotes| footnotes.borrow_mut().clear());
    TABLE_MARKS.with(|queue| queue.borrow_mut().clear());
    CELL_MARKS.with(|queue| queue.borrow_mut().clear());
    HEADER_ROWS.with(|queue| queue.borrow_mut().clear());
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
            .chain(rows.iter_mut())
            .flatten()
            .for_each(|cell| resolve_inlines(cell, definitions)),
        Block::Code { .. } | Block::Structure { .. } | Block::Rule => {}
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
            | Inline::Superscript(children)
            | Inline::Subscript(children)
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
        Block::Structure { smiles, .. } => smiles.clone(),
        Block::Table { header, rows, .. } => header
            .iter()
            .chain(rows.iter())
            .flatten()
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
    /// 当前表格行原文的结束位置：行中缺少的单元格由解析器补齐，位置在行尾，不是原文中的 `||`。
    row_end: usize,
    /// 最近一段行内内容（段落或紧凑列表项中的文字）在原文中的范围；遇到其他块的开始或结束时清除。
    /// 表格开始时据此判断紧贴在它之前的各行是不是表头行（见 header_lines）。
    run: Option<(usize, usize)>,
    run_open: bool,
    /// 上一个事件是 HTML 块的结束时，块在原文中的结束位置。
    html_end: Option<usize>,
}

impl<'a> Iterator for HeadingsAsText<'a> {
    type Item = Event<'a>;

    fn next(&mut self) -> Option<Event<'a>> {
        if let Some(event) = self.queued.pop_front() {
            return Some(event);
        }
        let (event, range) = self.inner.next()?;
        let html_end = self.html_end.take();
        match &event {
            Event::End(TagEnd::HtmlBlock) => self.html_end = Some(range.end),
            Event::Start(Tag::List(Some(_))) => {
                let adjacent = html_end.is_some_and(|end| {
                    // 块的范围可能不含行尾的换行；去掉它之后，到列表开始之间只剩容器的前缀（缩进、`>`）时没有空行。
                    let mut gap = &self.source[end..range.start];
                    if !self.source[..end].ends_with('\n') {
                        gap = gap.strip_prefix("\r\n").or_else(|| gap.strip_prefix('\n')).unwrap_or(gap);
                    }
                    !gap.contains('\n')
                });
                LIST_AFTER_HTML.with(|cell| cell.set(adjacent));
            }
            _ => {}
        }
        match &event {
            _ if is_inline_event(&event) => match (&mut self.run, self.run_open) {
                (Some(run), true) => run.1 = range.end,
                _ => {
                    self.run = Some((range.start, range.end));
                    self.run_open = true;
                }
            },
            Event::End(TagEnd::Paragraph) => self.run_open = false,
            Event::Start(Tag::Table(_)) => {
                let lines = self.run.take().and_then(|run| header_lines(self.source, run, range.start));
                HEADER_ROWS.with(|queue| queue.borrow_mut().push_back(lines));
                self.run_open = false;
            }
            _ => {
                self.run = None;
                self.run_open = false;
            }
        }
        match event {
            Event::Start(Tag::TableHead | Tag::TableRow) => self.row_end = range.end,
            Event::Start(Tag::TableCell) => {
                let mark = if range.is_empty() && range.start < self.row_end {
                    CellMark::Left
                } else if self.source[range.clone()].trim() == "^^" {
                    CellMark::Up
                } else {
                    CellMark::Plain
                };
                CELL_MARKS.with(|queue| queue.borrow_mut().push_back(mark));
            }
            _ => {}
        }
        if matches!(event, Event::Start(Tag::Paragraph)) {
            // 表格标题与表注按原文判断（`Table\: …`、`Table-note\: …` 转义后不是）。
            let source = self.source[range.clone()].trim_start();
            let mark = if source.starts_with(CAPTION_PREFIX) {
                TableMark::Caption
            } else if source.starts_with(NOTE_PREFIX) {
                TableMark::Note
            } else {
                TableMark::None
            };
            TABLE_MARKS.with(|queue| queue.borrow_mut().push_back(mark));
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
        TABLE_MARKS.with(|queue| queue.borrow_mut().push_back(TableMark::None));
        Some(Event::Start(Tag::Paragraph))
    }
}

fn is_inline_event(event: &Event) -> bool {
    let inline_tag = |tag: &Tag| {
        matches!(
            tag,
            Tag::Emphasis | Tag::Strong | Tag::Strikethrough | Tag::Superscript | Tag::Subscript | Tag::Link { .. } | Tag::Image { .. }
        )
    };
    match event {
        Event::Start(tag) => inline_tag(tag),
        Event::End(end) => matches!(
            end,
            TagEnd::Emphasis | TagEnd::Strong | TagEnd::Strikethrough | TagEnd::Superscript | TagEnd::Subscript | TagEnd::Link | TagEnd::Image
        ),
        Event::Rule => false,
        _ => true,
    }
}

/// 紧贴在表格之前（之间没有空行，也没有其他块）的一段文字，每一行（去掉引用记号与缩进后）都以 `|` 开头时，
/// 这些行是表头在分隔行之上多出的行（docs/decisions.md 第 23 节）。返回各行原文（去掉了引用记号与缩进）。
/// 与编辑器（ui/editor/markdown.ts 的表格规则）相同。
fn header_lines(source: &str, run: (usize, usize), table_start: usize) -> Option<Vec<String>> {
    let gap = source.get(run.1..table_start)?;
    if gap.chars().filter(|c| !matches!(c, ' ' | '\t' | '>')).collect::<String>() != "\n" {
        return None;
    }
    let lines: Vec<String> = source[run.0..run.1]
        .lines()
        .map(|line| line.trim_start_matches([' ', '\t', '>']).trim().to_owned())
        .collect();
    lines.iter().all(|line| line.starts_with('|')).then_some(lines)
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
    let mut pending = InlineRun::default();
    // 原文以 `Table: ` 开头的段落的位置：紧接着（之间没有其他块）是表格时成为表格的标题。
    let mut caption_at: Option<usize> = None;
    // 上一个段落之前的 caption_at：上一个段落成为表头行时，表格标题仍是它之前的段落。
    let mut caption_before: Option<usize> = None;
    let flush = |pending: &mut InlineRun, out: &mut Vec<Block>| {
        if !pending.is_empty() {
            out.push(Block::Paragraph(std::mem::take(pending).finish()));
        }
    };

    while let Some(event) = events.next() {
        match event {
            Event::End(end) if stop(&end) => break,
            Event::Start(Tag::Paragraph) => {
                flush(&mut pending, &mut out);
                let mark = TABLE_MARKS.with(|queue| queue.borrow_mut().pop_front()).unwrap_or(TableMark::None);
                let content = inlines(events, TagEnd::Paragraph);
                // 表注：紧跟在表格之后（之间没有其他块）的 `Table-note: ` 段落。
                if let (TableMark::Note, Some(Block::Table { note: note @ None, .. })) = (mark, out.last_mut()) {
                    *note = Some(table_note(&content));
                    caption_at = None;
                    continue;
                }
                out.push(Block::Paragraph(content));
                caption_before = caption_at;
                caption_at = (mark == TableMark::Caption).then_some(out.len() - 1);
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
                let (language, info) = match kind {
                    CodeBlockKind::Fenced(info) => {
                        (info.split_whitespace().next().map(str::to_owned), info.to_string())
                    }
                    CodeBlockKind::Indented => (None, String::new()),
                };
                let mut text = raw_text(events, TagEnd::CodeBlock);
                if language.as_deref().is_some_and(|language| language.eq_ignore_ascii_case("smiles")) {
                    out.push(Block::Structure { smiles: text.trim().to_owned(), conditions: StructureConditions::parse(&info) });
                    continue;
                }
                if text.ends_with('\n') {
                    text.pop();
                }
                out.push(Block::Code { language, text });
            }
            Event::Start(Tag::HtmlBlock) => {
                flush(&mut pending, &mut out);
                let text = raw_text(events, TagEnd::HtmlBlock);
                // 紧挨在有序列表之前的样式注释是列表的编号样式，不是文字。
                if let Some(numbering) = ListNumbering::from_comment(&text) {
                    if depth < MAX_NESTING
                        && matches!(events.peek(), Some(Event::Start(Tag::List(Some(_)))))
                        && LIST_AFTER_HTML.with(Cell::get)
                    {
                        if let Some(Event::Start(Tag::List(start))) = events.next() {
                            let mut block = list(events, start, depth + 1);
                            if let Block::List { numbering: slot, .. } = &mut block {
                                *slot = numbering;
                            }
                            out.push(block);
                        }
                        continue;
                    }
                }
                out.push(Block::Paragraph(vec![Inline::Text(
                    text.trim_end().to_owned(),
                )]));
            }
            Event::Start(Tag::List(start)) => {
                flush(&mut pending, &mut out);
                out.push(list(events, start, depth + 1));
            }
            Event::Start(Tag::Table(alignments)) => {
                // 紧贴在表格之前的表头行：去掉它们所在的段落（或紧凑列表项中的文字），并入表格。
                let lines = HEADER_ROWS.with(|queue| queue.borrow_mut().pop_front()).flatten();
                let lines = match lines {
                    Some(lines) if !pending.is_empty() => {
                        pending = InlineRun::default();
                        lines
                    }
                    Some(lines) if matches!(out.last(), Some(Block::Paragraph(_))) => {
                        out.pop();
                        caption_at = caption_before;
                        lines
                    }
                    _ => Vec::new(),
                };
                flush(&mut pending, &mut out);
                let mut block = table(events, &alignments, &lines);
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
            other => pending.push_event(other, events),
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
        numbering: ListNumbering::DEFAULT,
        items,
    }
}

fn table(events: &mut Events, alignments: &[Alignment], header_lines: &[String]) -> Block {
    let alignments: Vec<Align> = alignments
        .iter()
        .map(|a| match a {
            Alignment::None => Align::None,
            Alignment::Left => Align::Left,
            Alignment::Center => Align::Center,
            Alignment::Right => Align::Right,
        })
        .collect();
    let (mut grid, mut marks) = (Vec::new(), Vec::new());
    for line in header_lines {
        let (cells, row_marks) = header_line(line, alignments.len());
        grid.push(cells);
        marks.push(row_marks);
    }
    let (rest, rest_marks) = table_grid(events);
    let header_rows = header_lines.len() + 1;
    grid.extend(rest);
    marks.extend(rest_marks);
    let spans = cell_spans(&marks, header_rows);
    for span in &spans {
        for r in span.row..span.row + span.rows {
            for c in span.col..span.col + span.cols {
                if (r, c) != (span.row, span.col) {
                    grid[r][c].clear();
                }
            }
        }
    }
    let rows = grid.split_off(header_rows.min(grid.len()));
    Block::Table {
        alignments,
        header: grid,
        rows,
        spans,
        caption: None,
        note: None,
    }
}

/// 表格各行的单元格与合并记号（第一行是分隔行之上的那一行表头），直到表格结束。
fn table_grid(events: &mut Events) -> (Vec<Vec<Vec<Inline>>>, Vec<Vec<CellMark>>) {
    let mut grid: Vec<Vec<Vec<Inline>>> = Vec::new();
    let mut marks: Vec<Vec<CellMark>> = Vec::new();
    let mut row: Vec<Vec<Inline>> = Vec::new();
    let mut row_marks: Vec<CellMark> = Vec::new();
    while let Some(event) = events.next() {
        match event {
            Event::Start(Tag::TableCell) => {
                row_marks.push(CELL_MARKS.with(|queue| queue.borrow_mut().pop_front()).unwrap_or(CellMark::Plain));
                row.push(inlines(events, TagEnd::TableCell));
            }
            Event::End(TagEnd::TableHead | TagEnd::TableRow) => {
                grid.push(std::mem::take(&mut row));
                marks.push(std::mem::take(&mut row_marks));
            }
            Event::End(TagEnd::Table) => break,
            _ => {}
        }
    }
    (grid, marks)
}

/// 分隔行之上多出的一行表头：与 GFM 表格的行相同地切分并解析（单独作为一个表格的表头解析），
/// 单元格数补齐或截断为表格的列数。
fn header_line(line: &str, columns: usize) -> (Vec<Vec<Inline>>, Vec<CellMark>) {
    let count = gfm_cell_count(line).max(1);
    let source = format!("{line}\n|{}\n", "-|".repeat(count));
    let options = Options::ENABLE_TABLES | Options::ENABLE_STRIKETHROUGH | Options::ENABLE_MATH;
    let mut events = HeadingsAsText {
        source: &source,
        inner: Parser::new_ext(&source, options).into_offset_iter(),
        queued: VecDeque::new(),
        row_end: 0,
        run: None,
        run_open: false,
        html_end: None,
    }
    .peekable();
    let (mut cells, mut marks) = (Vec::new(), Vec::new());
    while let Some(event) = events.next() {
        if matches!(event, Event::Start(Tag::Table(_))) {
            // 这里的表格开始同样记下了一项表头行（总是 None），取出以免影响正文中之后的表格。
            HEADER_ROWS.with(|queue| queue.borrow_mut().pop_back());
            let (grid, grid_marks) = table_grid(&mut events);
            cells = grid.into_iter().next().unwrap_or_default();
            marks = grid_marks.into_iter().next().unwrap_or_default();
            break;
        }
    }
    cells.resize(columns, Vec::new());
    marks.resize(columns, CellMark::Plain);
    (cells, marks)
}

/// GFM 表格一行的单元格数（与 markdown-it 的切分相同：未转义的竖线分隔，首尾为空的部分不算单元格）。
fn gfm_cell_count(line: &str) -> usize {
    let mut parts = vec![String::new()];
    let mut escaped = false;
    for c in line.trim().chars() {
        if c == '|' && !escaped {
            parts.push(String::new());
        } else {
            parts.last_mut().unwrap().push(c);
        }
        escaped = c == '\\';
    }
    let mut count = parts.len();
    if parts.first().is_some_and(String::is_empty) {
        count -= 1;
    }
    if count > 0 && parts.last().is_some_and(String::is_empty) {
        count -= 1;
    }
    count
}

/// 由各单元格的合并记号得到合并区域（与编辑器 ui/editor/markdown.ts 的 tableSpans 相同）。
/// 前 header_rows 行是表头。按行依次处理没有被合并的单元格：右侧连续的 `||` 是它合并的列；之后各行中，
/// 它所在列是 `^^`、其余各列都是 `||` 时这一行也属于这个区域。表头第一行与正文第一行的 `^^` 不与上方合并
/// （区域不跨越表头与正文）；没有被合并的记号是普通单元格（`||` 是空单元格，`^^` 是文字），同样可以向右、向下合并。
fn cell_spans(marks: &[Vec<CellMark>], header_rows: usize) -> Vec<CellSpan> {
    let mark = |r: usize, c: usize| match marks.get(r).and_then(|row| row.get(c)) {
        Some(CellMark::Left) if c > 0 => CellMark::Left,
        Some(CellMark::Up) if r != 0 && r != header_rows => CellMark::Up,
        _ => CellMark::Plain,
    };
    let mut covered: Vec<Vec<bool>> = marks.iter().map(|row| vec![false; row.len()]).collect();
    let mut spans = Vec::new();
    for r in 0..marks.len() {
        for c in 0..marks[r].len() {
            if covered[r][c] || mark(r, c) == CellMark::Left {
                continue;
            }
            let mut cols = 1;
            while mark(r, c + cols) == CellMark::Left {
                cols += 1;
            }
            let mut rows = 1;
            while mark(r + rows, c) == CellMark::Up && (1..cols).all(|k| mark(r + rows, c + k) == CellMark::Left) {
                rows += 1;
            }
            if rows > 1 || cols > 1 {
                for row in &mut covered[r..r + rows] {
                    row[c..c + cols].fill(true);
                }
                spans.push(CellSpan { row: r, col: c, rows, cols });
            }
        }
    }
    spans
}

/// 读取行内内容直到指定结束标记。
fn inlines(events: &mut Events, end: TagEnd) -> Vec<Inline> {
    let mut run = InlineRun::default();
    while let Some(event) = events.next() {
        match event {
            Event::End(e) if e == end => break,
            event => run.push_event(event, events),
        }
    }
    run.finish()
}

#[derive(Clone, Copy, PartialEq, Eq)]
enum Script {
    Super,
    Sub,
}

impl Script {
    /// 恰好是 `<sup>` / `</sup>` / `<sub>` / `</sub>`（小写、没有属性与空白）时返回种类与是否为结束标签。
    fn tag(html: &str) -> Option<(Script, bool)> {
        match html {
            "<sup>" => Some((Script::Super, false)),
            "</sup>" => Some((Script::Super, true)),
            "<sub>" => Some((Script::Sub, false)),
            "</sub>" => Some((Script::Sub, true)),
            _ => None,
        }
    }

    fn wrap(self, children: Vec<Inline>) -> Inline {
        let children = without_scripts(normalize(children));
        match self {
            Script::Super => Inline::Superscript(children),
            Script::Sub => Inline::Subscript(children),
        }
    }
}

/// 一层行内内容（段落、强调、链接……之内）的收集。
///
/// 上下标（docs/decisions.md 第 21 节）：同一层中，结束标签与它之前最近的、尚未配对的同类开始标签配对，
/// 两者之间未配对的标签都是文字；配不上的标签是文字（与其他原始 HTML 相同）。
/// 编辑器（ui/editor/markdown.ts 的 writer_scripts）按同一规则配对。
#[derive(Default)]
struct InlineRun {
    out: Vec<Inline>,
    /// 尚未配对的开始标签：种类与它（作为文字）在 out 中的位置。
    open: Vec<(Script, usize)>,
}

impl InlineRun {
    fn push_event(&mut self, event: Event, events: &mut Events) {
        match event {
            Event::InlineHtml(html) => match Script::tag(&html) {
                Some((script, false)) => {
                    self.open.push((script, self.out.len()));
                    self.out.push(Inline::Text(html.into_string()));
                }
                Some((script, true)) => match self.open.iter().rposition(|(s, _)| *s == script) {
                    Some(index) => {
                        let at = self.open[index].1;
                        self.open.truncate(index);
                        let children = self.out.split_off(at + 1);
                        self.out.pop();
                        self.out.push(script.wrap(children));
                    }
                    None => self.out.push(Inline::Text(html.into_string())),
                },
                None => self.out.push(Inline::Text(html.into_string())),
            },
            Event::Start(tag) => {
                if let Some(inline) = inline_from_start(tag, events) {
                    self.out.push(inline);
                }
            }
            other => {
                if let Some(inline) = inline_from_leaf(other) {
                    self.out.push(inline);
                }
            }
        }
    }

    fn is_empty(&self) -> bool {
        self.out.is_empty()
    }

    fn finish(self) -> Vec<Inline> {
        normalize(self.out)
    }
}

/// 去掉上下标之中的上下标（只保留内容）。
fn without_scripts(inlines: Vec<Inline>) -> Vec<Inline> {
    let mut out = Vec::with_capacity(inlines.len());
    for inline in inlines {
        match inline {
            Inline::Superscript(children) | Inline::Subscript(children) => out.extend(without_scripts(children)),
            Inline::Strong(children) => out.push(Inline::Strong(without_scripts(children))),
            Inline::Emphasis(children) => out.push(Inline::Emphasis(without_scripts(children))),
            Inline::Strike(children) => out.push(Inline::Strike(without_scripts(children))),
            Inline::Link { url, children } => out.push(Inline::Link { url, children: without_scripts(children) }),
            other => out.push(other),
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
            // 未启用的扩展（pulldown-cmark 自己的 ^上标^ / ~下标~ 等）：保留其中的文字。
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
            Inline::Strong(c)
            | Inline::Emphasis(c)
            | Inline::Strike(c)
            | Inline::Superscript(c)
            | Inline::Subscript(c) => text.push_str(&plain_text(c)),
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
                    numbering: ListNumbering::DEFAULT,
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
                numbering: ListNumbering::DEFAULT,
                items: vec![
                    vec![
                        Block::Paragraph(vec![text("甲")]),
                        Block::List {
                            ordered: true,
                            start: 1,
                            numbering: ListNumbering::DEFAULT,
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
    fn smiles_fences_are_structures() {
        assert_eq!(
            parse("```smiles\n  CCO \n```\n\n~~~SMILES x\nC=C\n~~~\n\n```js\nCCO\n```"),
            vec![
                Block::Structure { smiles: "CCO".into(), conditions: StructureConditions::default() },
                Block::Structure { smiles: "C=C".into(), conditions: StructureConditions::default() },
                Block::Code { language: Some("js".into()), text: "CCO".into() },
            ]
        );
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
                header: vec![vec![vec![text("组别")], vec![text("数")]]],
                rows: vec![
                    vec![vec![text("对照")], vec![text("30")]],
                    vec![vec![text("实验")], vec![Inline::Strong(vec![text("32")])]],
                ],
                spans: vec![],
                caption: None,
                note: None,
            }]
        );
    }

    #[test]
    fn merged_cells_are_marked_in_the_source() {
        let spans = |markdown: &str| match parse(markdown).first() {
            Some(Block::Table { spans, .. }) => spans.clone(),
            Some(Block::Quote(blocks)) => match blocks.first() {
                Some(Block::Table { spans, .. }) => spans.clone(),
                _ => panic!("不是表格"),
            },
            _ => panic!("不是表格"),
        };
        let span = |row, col, rows, cols| CellSpan { row, col, rows, cols };
        // 表头中横向合并；正文中纵向、横向与二维合并。
        assert_eq!(spans("| a || b |\n|---|---|---|\n| 1 | 2 | 3 |"), vec![span(0, 0, 1, 2)]);
        assert_eq!(
            spans("| a | b | c |\n|---|---|---|\n| 1 | 2 || \n| ^^ | 3 | 4 |\n| 5 | 6 || \n| 7 | ^^ || "),
            vec![span(1, 0, 2, 1), span(1, 1, 1, 2), span(3, 1, 2, 2)]
        );
        // 有空白的空单元格、补齐的单元格、转义的 \^^、正文第一行的 ^^ 都不合并。
        assert_eq!(spans("| a |  | b |\n|---|---|---|\n| 1 |"), vec![]);
        assert_eq!(spans("| a |\n|---|\n| 1 |\n| \\^^ |"), vec![]);
        assert_eq!(spans("| a |\n|---|\n| ^^ |"), vec![]);
        // 第一列的 || 没有可以合并的单元格；没有形成合并的 ^^ 是文字，也可以向右合并。
        assert_eq!(spans("|| a |\n|---|---|\n| 1 | 2 |"), vec![]);
        assert_eq!(spans("| a | b | c |\n|---|---|---|\n| ^^ || x |"), vec![span(1, 0, 1, 2)]);
        // 区域只有一列时，下方 ^^ 右侧的 || 不属于区域，是空单元格。
        assert_eq!(spans("| a | b | c |\n|---|---|---|\n| 1 | 2 | 3 |\n| x | ^^ || "), vec![span(1, 1, 2, 1)]);
        // 区域内的位置不是一致的记号时这一行不属于区域。
        assert_eq!(spans("| a | b |\n|---|---|\n| 1 || \n| ^^ | x |"), vec![span(1, 0, 1, 2)]);
        // 嵌套在引用中的表格同样按原文判断。
        assert_eq!(spans("> | a || b |\n> |---|---|---|"), vec![span(0, 0, 1, 2)]);
    }

    #[test]
    fn merged_cells_keep_the_grid_and_the_content_in_the_first_cell() {
        let blocks = parse("| a || b |\n|---|---|---|\n| ^^ | 2 | 3 |\n| ^^ | \\^^ |  |");
        let Some(Block::Table { header, rows, .. }) = blocks.first() else { panic!("不是表格") };
        assert_eq!(header, &vec![vec![vec![text("a")], vec![], vec![text("b")]]]);
        // 正文第一行的 ^^ 不与表头合并，是文字；第二行的 ^^ 与它合并，位置是空单元格。转义的 \^^ 是文字。
        assert_eq!(rows[0], vec![vec![text("^^")], vec![text("2")], vec![text("3")]]);
        assert_eq!(rows[1], vec![vec![], vec![text("^^")], vec![]]);
    }

    #[test]
    fn lines_right_above_the_header_are_more_header_rows() {
        fn find_table(blocks: Vec<Block>) -> Option<Block> {
            blocks.into_iter().find_map(|block| match block {
                Block::Table { .. } => Some(block),
                Block::Quote(children) => find_table(children),
                Block::List { items, .. } => find_table(items.into_iter().flatten().collect()),
                _ => None,
            })
        }
        let table = |markdown: &str| match find_table(parse(markdown)) {
            Some(Block::Table { header, rows, spans, caption, .. }) => (header, rows, spans, caption),
            _ => panic!("不是表格"),
        };
        let span = |row, col, rows, cols| CellSpan { row, col, rows, cols };
        let (header, rows, spans, _) = table("| 地区 | 2024 || 备注 |\n| ^^ | 上 | 下 | ^^ |\n|---|---|---|---|\n| 华东 | 1 | 2 | 甲 |\n| ^^ | 3 || 乙 |");
        assert_eq!(header.len(), 2);
        assert_eq!(header[0], vec![vec![text("地区")], vec![text("2024")], vec![], vec![text("备注")]]);
        assert_eq!(header[1], vec![vec![], vec![text("上")], vec![text("下")], vec![]]);
        assert_eq!(rows.len(), 2);
        // 表头内纵向合并；正文第一行的 ^^ 不与表头合并（区域不跨越表头与正文）。
        assert_eq!(spans, vec![span(0, 0, 2, 1), span(0, 1, 1, 2), span(0, 3, 2, 1), span(2, 0, 2, 1), span(3, 1, 1, 2)]);
        let (_, rows, spans, _) = table("| a |\n|---|\n| ^^ |");
        assert_eq!((rows, spans), (vec![vec![vec![text("^^")]]], vec![]));
        // 多出的行单元格数补齐或截断为表格的列数；行内格式照常解析，转义的竖线是文字。
        let (header, _, _, _) = table("| **x** | a\\|b | c |\n| a | b |\n|---|---|");
        assert_eq!(header[0], vec![vec![Inline::Strong(vec![text("x")])], vec![text("a|b")]]);
        let (header, _, _, _) = table("| x |\n| a | b |\n|---|---|");
        assert_eq!(header[0], vec![vec![text("x")], vec![]]);
        // 表格标题仍是表头行之前的段落；在引用与紧凑列表项中同样适用。
        let (header, _, _, caption) = table("Table: 甲\n\n| x |\n| a |\n|---|");
        assert_eq!((header.len(), caption.map(|c| c.text)), (2, Some("甲".to_owned())));
        assert_eq!(table("> | x |\n> | a |\n> |---|").0.len(), 2);
        assert_eq!(table("- | x |\n  | a |\n  |---|").0.len(), 2);
        assert_eq!(parse("- | x |\n  | a |\n  |---|").len(), 1);
        // 隔着空行、不全是以 | 开头的行、或前面是其他块时，段落保留。
        assert_eq!(table("| x |\n\n| a |\n|---|").0.len(), 1);
        assert_eq!(table("文字\n| x |\n| a |\n|---|").0.len(), 1);
        assert_eq!(parse("文字\n| x |\n| a |\n|---|").len(), 2);
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
    fn table_note_is_the_paragraph_after_the_table_in_the_source() {
        let note = |markdown: &str| match parse(markdown).first() {
            Some(Block::Table { note, .. }) => note.clone(),
            _ => None,
        };
        assert_eq!(note("| a |\n| - |\n\nTable-note: 注：*数据*来自问卷。"), Some("注：数据来自问卷。".into()));
        // 表注不在正文中重复出现；每个表格只有一个表注，之后的同样段落是普通段落。
        assert_eq!(parse("| a |\n| - |\n\nTable-note: 甲").len(), 1);
        assert_eq!(parse("| a |\n| - |\n\nTable-note: 甲\n\nTable-note: 乙").len(), 2);
        // 转义后不是表注；之间隔着其他块、或前面不是表格时，段落保留。
        assert_eq!(note("| a |\n| - |\n\nTable-note\\: 文字"), None);
        assert_eq!(note("| a |\n| - |\n\n---\n\nTable-note: 甲"), None);
        assert_eq!(parse("Table-note: 只是文字").len(), 1);
        // 标题与表注可以同时存在；表注之后紧接着下一个表格的标题。
        let blocks = parse("Table: 甲\n\n| a |\n| - |\n\nTable-note: 注\n\nTable: 乙\n\n| b |\n| - |");
        assert_eq!(blocks.len(), 2);
        assert!(matches!(&blocks[0], Block::Table { caption: Some(c), note: Some(n), .. } if c.text == "甲" && n == "注"));
        assert!(matches!(&blocks[1], Block::Table { caption: Some(c), note: None, .. } if c.text == "乙"));
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

    /// 编号样式（docs/decisions.md 第 24 节）：紧挨在有序列表之前的样式注释，与编辑器的规则相同。
    #[test]
    fn list_numbering_comment_styles_the_following_ordered_list() {
        let numbering = |markdown: &str| {
            fn walk(blocks: &[Block], out: &mut Vec<&'static str>) {
                for block in blocks {
                    match block {
                        Block::List { ordered: true, numbering, items, .. } => {
                            out.push(numbering.pattern());
                            items.iter().for_each(|item| walk(item, out));
                        }
                        Block::List { items, .. } => items.iter().for_each(|item| walk(item, out)),
                        Block::Quote(blocks) => walk(blocks, out),
                        _ => {}
                    }
                }
            }
            let mut out = Vec::new();
            walk(&parse(markdown), &mut out);
            out
        };
        assert_eq!(numbering("<!-- writer:list 一、 -->\n3. 甲"), ["一、"]);
        assert_eq!(numbering("段落\n<!-- writer:list ① -->\n3. 甲"), ["①"]);
        assert_eq!(parse("段落\n<!-- writer:list ① -->\n3. 甲")[0], Block::Paragraph(vec![text("段落")]));
        assert_eq!(numbering("1. <!-- writer:list i. -->\n   1. 甲"), ["1.", "i."]);
        assert_eq!(numbering("1. 甲\n   <!-- writer:list a. -->\n   1. 乙"), ["1.", "a."]);
        assert_eq!(numbering("> <!-- writer:list I. -->\n> 1. 甲"), ["I."]);
        assert_eq!(numbering("<!--writer:list\t(1)-->\r\n1. 甲"), ["(1)"]);
        // 中间有空行、样式不认识、多余的文字：注释是文字。
        for markdown in ["<!-- writer:list (1) -->\n\n1. 甲", "<!-- writer:list (2) -->\n1. 甲", "<!-- writer:list (1) --> x\n1. 甲"] {
            assert_eq!(numbering(markdown), ["1."], "{markdown}");
            assert!(matches!(&parse(markdown)[0], Block::Paragraph(_)), "{markdown}");
        }
        // 无序列表之前：文字。
        assert!(matches!(&parse("<!-- writer:list (1) -->\n- 甲")[0], Block::Paragraph(_)));
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
    fn superscript_and_subscript_tags() {
        let sup = |children: Vec<Inline>| Inline::Superscript(children);
        let sub = |children: Vec<Inline>| Inline::Subscript(children);
        assert_eq!(
            parse("50 m<sup>3</sup>/d，H<sub>2</sub>O，10<sup>**-3**</sup>"),
            vec![Block::Paragraph(vec![
                text("50 m"),
                sup(vec![text("3")]),
                text("/d，H"),
                sub(vec![text("2")]),
                text("O，10"),
                sup(vec![Inline::Strong(vec![text("-3")])]),
            ])]
        );
        // 紧凑列表项（没有段落包裹）与表格中同样有效。
        assert_eq!(
            parse("- x<sup>2</sup>"),
            vec![Block::List {
                ordered: false,
                start: 1,
                numbering: ListNumbering::DEFAULT,
                items: vec![vec![Block::Paragraph(vec![text("x"), sup(vec![text("2")])])]],
            }]
        );
        // 配不上的、大写的、带属性的、转义的标签都是文字。
        for source in ["a<sup>b c</sub>", "<SUP>d</SUP>", "<sup class=\"x\">e</sup>", "<sup >e</sup>", "f</sup>"] {
            assert_eq!(parse(source), vec![Block::Paragraph(vec![text(source)])], "{source}");
        }
        assert_eq!(parse("\\<sup>f</sup>"), vec![Block::Paragraph(vec![text("<sup>f</sup>")])]);
        // 只与同一层中的标签配对：跨越强调边界的不配对。
        assert_eq!(
            parse("<sup>*a</sup>*"),
            vec![Block::Paragraph(vec![text("<sup>"), Inline::Emphasis(vec![text("a</sup>")])])]
        );
        // 交错时结束标签与最近的同类开始标签配对，中间未配对的是文字。
        assert_eq!(
            parse("<sup>a<sub>b</sup>c</sub>"),
            vec![Block::Paragraph(vec![sup(vec![text("a<sub>b")]), text("c</sub>")])]
        );
        // 嵌套时以外层为准。
        assert_eq!(
            parse("<sup>a<sub>b</sub>*<sup>c</sup>*</sup>"),
            vec![Block::Paragraph(vec![sup(vec![text("ab"), Inline::Emphasis(vec![text("c")])])])]
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
                    numbering: ListNumbering::DEFAULT,
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
