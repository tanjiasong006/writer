//! 编辑器 ⇄ Rust 导出的内容契约（docs/decisions.md 第 8 节"编辑与输出的内容契约验证"）。
//!
//! 共享用例在 `fixtures/markdown/`：`<name>.md` 原文、`<name>.json` 人工审查的预期语义（中立 JSON 块树）、
//! `<name>.serialized.md` 编辑器实际写出的正文（golden，由前端 Vitest 生成与校验）。
//! 这里验证原文与 golden 解析得到的 IR 都符合预期语义：编辑器写回的正文导出后内容与结构不变。
//! 投影只存在于测试中，不是产品模型或运行时协议。

use std::fs;
use std::path::PathBuf;

use serde_json::{json, Map, Value};

use super::markdown::{parse, Align, Block, Inline};

fn fixtures() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/markdown")
}

/// 带标记集合的行内片段，标记按名称排序后参与比较。
fn runs(inlines: &[Inline], marks: &[String], out: &mut Vec<Value>) {
    let with_marks = |mut value: Map<String, Value>| {
        if !marks.is_empty() {
            let mut sorted = marks.to_vec();
            sorted.sort();
            value.insert("marks".into(), json!(sorted));
        }
        Value::Object(value)
    };
    // 标记是集合：同一种强调嵌套在自身之中（粗体里的粗体）显示上没有区别。
    let nested = |extra: String, children: &[Inline], out: &mut Vec<Value>| {
        let mut inner = marks.to_vec();
        if !inner.contains(&extra) {
            inner.push(extra);
        }
        runs(children, &inner, out);
    };
    for inline in inlines {
        match inline {
            Inline::Text(text) => out.push(with_marks(object(json!({ "text": text })))),
            // 中文之间的软换行已在解析时去掉，其余按 CommonMark 显示为空格。
            Inline::SoftBreak => out.push(with_marks(object(json!({ "text": " " })))),
            Inline::HardBreak => out.push(json!({ "break": true })),
            Inline::Code(code) => out.push(with_marks(object(json!({ "code": code })))),
            Inline::Image { src, alt } => {
                out.push(with_marks(object(json!({ "image": src, "alt": alt }))))
            }
            Inline::Strong(children) => nested("strong".into(), children, out),
            Inline::Emphasis(children) => nested("emphasis".into(), children, out),
            Inline::Strike(children) => nested("strike".into(), children, out),
            Inline::Link { url, children } => nested(format!("link:{url}"), children, out),
        }
    }
}

fn object(value: Value) -> Map<String, Value> {
    match value {
        Value::Object(map) => map,
        _ => unreachable!(),
    }
}

/// 行内内容的语义：相邻、标记相同的文字合并。
fn inlines(inlines: &[Inline]) -> Value {
    let mut out = Vec::new();
    runs(inlines, &[], &mut out);
    let mut merged: Vec<Value> = Vec::new();
    for run in out {
        if let (Some(last), Some(text)) = (merged.last_mut(), run.get("text")) {
            if let Some(previous) = last.get("text").and_then(Value::as_str) {
                if last.get("marks") == run.get("marks") {
                    last["text"] = json!(format!("{previous}{}", text.as_str().unwrap()));
                    continue;
                }
            }
        }
        merged.push(run);
    }
    Value::Array(merged)
}

fn blocks(blocks: &[Block]) -> Value {
    Value::Array(blocks.iter().map(block).collect())
}

fn block(block: &Block) -> Value {
    if let Some((src, alt)) = block.as_figure() {
        return json!({ "type": "figure", "src": src, "alt": alt });
    }
    match block {
        Block::Paragraph(content) => json!({ "type": "paragraph", "inlines": inlines(content) }),
        Block::Heading { level, inlines: content } => {
            json!({ "type": "heading", "level": level, "inlines": inlines(content) })
        }
        Block::Quote(children) => json!({ "type": "quote", "blocks": blocks(children) }),
        Block::Code { language, text } => {
            json!({ "type": "code", "language": language, "text": text })
        }
        Block::Rule => json!({ "type": "rule" }),
        Block::List { ordered, start, items } => json!({
            "type": "list",
            "ordered": ordered,
            "start": start,
            "items": items.iter().map(|item| list_item(item)).collect::<Vec<_>>(),
        }),
        Block::Table { alignments, header, rows } => json!({
            "type": "table",
            "align": alignments.iter().map(|a| match a {
                Align::None => "none",
                Align::Left => "left",
                Align::Center => "center",
                Align::Right => "right",
            }).collect::<Vec<_>>(),
            "header": header.iter().map(|cell| inlines(cell)).collect::<Vec<_>>(),
            "rows": rows.iter().map(|row| row.iter().map(|cell| inlines(cell)).collect::<Vec<_>>()).collect::<Vec<_>>(),
        }),
    }
}

/// 列表项：解析器把任务列表标记输出为首段开头的 "☐ " / "☑ "，投影为 task。
fn list_item(item: &[Block]) -> Value {
    let mut item = item.to_vec();
    let mut task = Value::Null;
    if let Some(Block::Paragraph(content)) = item.first_mut() {
        if let Some(Inline::Text(text)) = content.first_mut() {
            for (marker, done) in [("☐ ", false), ("☑ ", true)] {
                if let Some(rest) = text.strip_prefix(marker) {
                    task = json!(done);
                    *text = rest.to_owned();
                }
            }
        }
    }
    json!({ "task": task, "blocks": blocks(&item) })
}

#[test]
fn original_and_editor_output_match_expected_semantics() {
    let mut names: Vec<String> = fs::read_dir(fixtures())
        .unwrap()
        .filter_map(|entry| entry.unwrap().file_name().into_string().ok())
        .filter(|name| name.ends_with(".md") && !name.ends_with(".serialized.md"))
        .map(|name| name.trim_end_matches(".md").to_owned())
        .collect();
    names.sort();
    assert!(!names.is_empty());
    for name in names {
        let read = |suffix: &str| {
            fs::read_to_string(fixtures().join(format!("{name}{suffix}")))
                .unwrap_or_else(|error| panic!("{name}{suffix}: {error}"))
        };
        let expected: Value = serde_json::from_str(&read(".json")).unwrap();
        let expected = &expected["blocks"];
        assert_eq!(&blocks(&parse(&read(".md"))), expected, "{name}.md");
        // golden 由编辑器生成：缺失说明前端测试没有运行或没有提交。
        assert_eq!(
            &blocks(&parse(&read(".serialized.md"))),
            expected,
            "{name}.serialized.md"
        );
    }
}
