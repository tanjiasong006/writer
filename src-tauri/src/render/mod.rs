//! 全文渲染：把前端按章节树顺序展开的文档解析成统一模型，供导出（Word / PDF）使用。
//!
//! 章节标题与编号只来自文档结构（前端传入），正文 Markdown 中不包含它们（docs/decisions.md 第 3 节）。

#[cfg(test)]
mod contract_tests;
pub mod markdown;

use std::path::{Component, Path, PathBuf};

use serde::Deserialize;

use markdown::Block;

/// 前端传入的待渲染文档：只有标题与按树的先序顺序展开的章节内容与结构。
/// 不携带任何排版参数：Word / PDF 各自取得输出参数（`export::theme`）。
#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderRequest {
    pub title: String,
    pub chapters: Vec<RenderChapter>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RenderChapter {
    pub id: String,
    /// 各级编号，如 [2, 1]；层级 = 长度。
    pub number: Vec<u32>,
    pub title: String,
    pub markdown: String,
}

/// 统一的渲染模型。
#[derive(Debug, Clone, PartialEq)]
pub struct Document {
    pub title: String,
    pub sections: Vec<Section>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Section {
    pub chapter_id: String,
    /// 显示编号，如 "2.1"。
    pub number: String,
    pub title: String,
    /// 章节层级，根层级为 1。
    pub depth: usize,
    pub blocks: Vec<Block>,
}

impl Section {
    /// 正文内部标题的实际层级：章节层级之下再加 Markdown 级别。
    pub fn body_heading_depth(&self, markdown_level: u8) -> usize {
        self.depth + usize::from(markdown_level)
    }
}

pub fn build(request: &RenderRequest) -> Document {
    Document {
        title: request.title.clone(),
        sections: request
            .chapters
            .iter()
            .map(|chapter| Section {
                chapter_id: chapter.id.clone(),
                number: chapter
                    .number
                    .iter()
                    .map(u32::to_string)
                    .collect::<Vec<_>>()
                    .join("."),
                title: chapter.title.clone(),
                depth: chapter.number.len().max(1),
                blocks: markdown::parse(&chapter.markdown),
            })
            .collect(),
    }
}

/// 解析正文中的图片引用：相对于 content/ 目录，必须位于项目目录内且是存在的文件。
/// 网络地址、data URI、越出项目目录的路径一律返回 None（渲染器显示占位）。
pub fn resolve_image(project_root: &Path, src: &str) -> Option<PathBuf> {
    if src.contains("://") || src.starts_with("data:") || src.is_empty() {
        return None;
    }
    let decoded = percent_decode(src)?;
    let relative = Path::new(&decoded);
    if relative.is_absolute() {
        return None;
    }
    let mut resolved = project_root.join("content");
    for component in relative.components() {
        match component {
            Component::Normal(part) => resolved.push(part),
            Component::ParentDir => {
                resolved.pop();
            }
            Component::CurDir => {}
            _ => return None,
        }
    }
    // 比较规范化路径，防止通过符号链接指向项目外的文件。
    let canonical_root = project_root.canonicalize().ok()?;
    let canonical = resolved.canonicalize().ok()?;
    if !canonical.starts_with(&canonical_root) || !canonical.is_file() {
        return None;
    }
    Some(resolved)
}

/// 解码 %XX；非法编码或解码后不是 UTF-8 时返回 None。
fn percent_decode(text: &str) -> Option<String> {
    let bytes = text.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' {
            let hex = text.get(i + 1..i + 3)?;
            out.push(u8::from_str_radix(hex, 16).ok()?);
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
    use std::fs;
    use tempfile::TempDir;

    #[test]
    fn build_formats_numbers_and_depth() {
        let document = build(&RenderRequest {
            title: "论文".into(),
            chapters: vec![
                RenderChapter {
                    id: "a".into(),
                    number: vec![1],
                    title: "绪论".into(),
                    markdown: "正文".into(),
                },
                RenderChapter {
                    id: "b".into(),
                    number: vec![1, 2],
                    title: "方法".into(),
                    markdown: String::new(),
                },
            ],
        });
        assert_eq!(document.sections[0].number, "1");
        assert_eq!(document.sections[1].number, "1.2");
        assert_eq!(document.sections[1].depth, 2);
        assert_eq!(document.sections[1].body_heading_depth(1), 3);
        assert!(document.sections[1].blocks.is_empty());
    }

    /// 与前端 application/document_output.ts 的 RenderRequest 形状一致。
    #[test]
    fn request_deserializes_from_frontend_json() {
        let json = r#"{"title":"论文","chapters":[{"id":"a","number":[1,2],"title":"方法","markdown":"正文"}]}"#;
        let request: RenderRequest = serde_json::from_str(json).unwrap();
        assert_eq!(request.chapters[0].number, vec![1, 2]);
        let document = build(&request);
        assert_eq!(document.sections[0].number, "1.2");
    }

    #[test]
    fn resolve_image_stays_inside_project() {
        let dir = TempDir::new().unwrap();
        let root = dir.path().join("项目");
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::create_dir_all(root.join("content")).unwrap();
        fs::write(root.join("assets/实验 图.png"), b"x").unwrap();
        fs::write(dir.path().join("secret.png"), b"x").unwrap();

        assert_eq!(
            resolve_image(&root, "../assets/实验 图.png"),
            Some(root.join("assets/实验 图.png"))
        );
        assert_eq!(
            resolve_image(&root, "../assets/%E5%AE%9E%E9%AA%8C%20%E5%9B%BE.png"),
            Some(root.join("assets/实验 图.png"))
        );
        assert_eq!(resolve_image(&root, "../../secret.png"), None);
        assert_eq!(resolve_image(&root, "/etc/hosts"), None);
        assert_eq!(resolve_image(&root, "https://example.com/a.png"), None);
        assert_eq!(resolve_image(&root, "data:image/png;base64,AAAA"), None);
        assert_eq!(resolve_image(&root, "../assets/missing.png"), None);
        assert_eq!(resolve_image(&root, "../assets/%ZZ.png"), None);
        assert_eq!(resolve_image(&root, ""), None);

        #[cfg(unix)]
        {
            std::os::unix::fs::symlink(dir.path().join("secret.png"), root.join("assets/link.png"))
                .unwrap();
            assert_eq!(resolve_image(&root, "../assets/link.png"), None);
        }
    }
}
