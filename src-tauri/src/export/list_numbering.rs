//! 有序列表的编号文字（docs/decisions.md 第 24 节）：按 Typst 的编号规则生成，HTML / EPUB 与 PDF 的编号因此相同。
//! 与前端 `domain/list_numbering` 共享 `fixtures/list_numbering.json`，两侧测试都读取它。

use std::str::FromStr;

use typst::model::NumberingPattern;

use crate::render::markdown::ListNumbering;

/// 第 n 项的编号文字（含前后缀）。计数符号表示不了的数（如 0 的字母、51 以上的圈码）以阿拉伯数字代替，
/// 与 Typst 排版时的处理相同。
pub fn marker(numbering: ListNumbering, n: u64) -> String {
    let apply = |pattern: &str| NumberingPattern::from_str(pattern).ok()?.apply(None, &[n]).ok();
    let pattern = numbering.pattern();
    apply(pattern)
        .or_else(|| {
            let counter = pattern.find(['1', '一', '①', 'I', 'i', 'A', 'a'])?;
            let symbol = pattern[counter..].chars().next()?;
            Some(format!("{}{n}{}", &pattern[..counter], &pattern[counter + symbol.len_utf8()..]).into())
        })
        .map(|text| text.to_string())
        .unwrap_or_else(|| n.to_string())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn markers_match_shared_fixture() {
        let path = std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("fixtures/list_numbering.json");
        let cases: Vec<(String, u64, String)> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
        for (pattern, n, expected) in cases {
            let numbering = ListNumbering::parse(&pattern).unwrap_or_else(|| panic!("{pattern}"));
            assert_eq!(marker(numbering, n), expected, "{pattern} {n}");
        }
    }

    #[test]
    fn every_style_is_a_typst_pattern() {
        for pattern in ListNumbering::ALL {
            assert!(NumberingPattern::from_str(pattern).is_ok(), "{pattern}");
        }
    }
}
