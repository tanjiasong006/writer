//! 项目内文件名校验：来自 manifest / journal 的名字进入路径拼接前必须通过这里，杜绝路径穿越。

/// 正文文件名：`ch_` + 以 `_` 连接的正整数（无前导 0）+ `.md`，如 `ch_2_1.md`。
/// 与 TS 侧 `project_format.isContentFileName` 保持一致。
pub fn is_content_file_name(name: &str) -> bool {
    let Some(numbers) = name
        .strip_prefix("ch_")
        .and_then(|rest| rest.strip_suffix(".md"))
    else {
        return false;
    };
    numbers.split('_').all(|part| {
        !part.is_empty() && part.bytes().all(|b| b.is_ascii_digit()) && !part.starts_with('0')
    })
}

/// staging 文件名：`<序号>.md`。
pub fn is_staged_file_name(name: &str) -> bool {
    name.strip_suffix(".md")
        .is_some_and(|n| !n.is_empty() && n.bytes().all(|b| b.is_ascii_digit()))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn content_file_names() {
        for name in ["ch_1.md", "ch_2_1.md", "ch_10_20_3.md"] {
            assert!(is_content_file_name(name), "{name}");
        }
        for name in [
            "ch_.md",
            "ch_0.md",
            "ch_01.md",
            "ch_1_.md",
            "ch__1.md",
            "ch_1.MD",
            "../ch_1.md",
            "a/ch_1.md",
            "ch_1/.md",
            "ch_1.md ",
            "ch_一.md",
            "",
            "ch_-1.md",
            "ch_1.md\0",
        ] {
            assert!(!is_content_file_name(name), "{name:?}");
        }
    }

    #[test]
    fn staged_file_names() {
        assert!(is_staged_file_name("0.md"));
        assert!(is_staged_file_name("12.md"));
        assert!(!is_staged_file_name(".md"));
        assert!(!is_staged_file_name("../0.md"));
        assert!(!is_staged_file_name("writer.json"));
    }
}
