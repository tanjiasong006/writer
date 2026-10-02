//! 章节交叉引用的地址（docs/project-format.md 第 4.1 节）：`writer:chapter/<百分号编码的 id>[?show=number|title]`。
//! 与前端 `domain/chapter_reference` 的规则相同，由共享 Markdown fixture 约束。

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
