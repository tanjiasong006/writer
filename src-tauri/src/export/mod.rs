//! Word / PDF 导出。两者都从 `render::Document` 生成，保证彼此结构一致。
//!
//! 通用约定：
//! - 输出文件先写到同目录临时文件，完整写入并 fsync 后再 rename，失败时不会留下半个文件，
//!   也不会破坏同名的旧文件。
//! - 用户数据（图片等）中的任何问题都不能让导出崩溃：图片无法读取时输出占位文字并计入报告。

pub mod docx;
pub mod epub;
pub mod fonts;
pub mod html;
pub mod images;
pub mod markdown;
pub mod math;
pub mod pdf;
pub mod pdf_layout;
pub mod theme;

use std::fs::{self, File};
use std::io::Write;
use std::path::Path;

use serde::Serialize;

use crate::io_kind::{classify, IoKind};

#[derive(Debug, Serialize, PartialEq, Eq)]
#[serde(tag = "code", rename_all = "kebab-case")]
pub enum ExportError {
    /// 系统中找不到能显示中文的字体（PDF 导出）。
    NoCjkFont,
    Io {
        kind: IoKind,
        message: String,
    },
    RenderFailed {
        message: String,
    },
}

/// 导出完成后的报告：可恢复的问题，前端据此提示用户。
#[derive(Debug, Default, Serialize, PartialEq, Eq)]
#[serde(rename_all = "camelCase")]
pub struct ExportReport {
    /// 无法嵌入的图片引用（缺失、越出项目、格式损坏）。
    pub missing_images: Vec<String>,
    /// 失效的章节引用（目标章节不存在或地址格式错误）的链接文字，已按文字输出。
    pub broken_references: Vec<String>,
    /// 无法排版的公式（LaTeX 原文），已按原文输出。
    pub invalid_formulas: Vec<String>,
}

/// 文件系统错误 → 导出错误。
pub fn io_failure(error: std::io::Error) -> ExportError {
    ExportError::Io { kind: classify(&error), message: error.to_string() }
}

/// 原子写出导出文件：临时文件 → fsync → rename。
pub fn write_output(target: &Path, bytes: &[u8]) -> Result<(), ExportError> {
    let io = |error: std::io::Error| ExportError::Io {
        kind: classify(&error),
        message: error.to_string(),
    };
    let dir = target
        .parent()
        .filter(|p| !p.as_os_str().is_empty())
        .unwrap_or(Path::new("."));
    let name = target.file_name().ok_or_else(|| ExportError::Io {
        kind: IoKind::Other,
        message: "invalid target path".into(),
    })?;
    let tmp = dir.join(format!(".{}.writer-tmp", name.to_string_lossy()));
    let result = (|| {
        let mut file = File::create(&tmp)?;
        file.write_all(bytes)?;
        file.sync_all()?;
        fs::rename(&tmp, target)
    })();
    if result.is_err() {
        let _ = fs::remove_file(&tmp);
    }
    result.map_err(io)
}

#[cfg(test)]
mod tests {
    use super::*;
    use tempfile::TempDir;

    #[test]
    fn write_output_replaces_atomically_and_cleans_up() {
        let dir = TempDir::new().unwrap();
        let target = dir.path().join("论文 终稿.docx");
        fs::write(&target, b"old").unwrap();
        write_output(&target, b"new").unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"new");
        assert_eq!(fs::read_dir(dir.path()).unwrap().count(), 1);

        let missing_dir = dir.path().join("不存在/论文.docx");
        assert!(matches!(
            write_output(&missing_dir, b"x"),
            Err(ExportError::Io { .. })
        ));
    }

    /// 手动核对用的压力样例：多页表格、长代码块、竖长 / 超宽图片、长 URL、深层章节、空章节、
    /// 原始 HTML、任务列表、正文内标题。生成 stress.docx 与 stress.pdf：
    /// `WRITER_SAMPLE_DIR=<目录> cargo test write_stress_sample -- --ignored`
    #[test]
    #[ignore]
    fn write_stress_sample() {
        use crate::export::images::tests::write_image;
        use crate::render::{build, RenderChapter, RenderRequest};
        let out = std::path::PathBuf::from(std::env::var("WRITER_SAMPLE_DIR").expect("WRITER_SAMPLE_DIR"));
        let root = out.join("stress-project");
        fs::create_dir_all(root.join("assets")).unwrap();
        fs::create_dir_all(root.join("content")).unwrap();
        write_image(&root.join("assets/竖图.png"), 400, 1600, image::ImageFormat::Png);
        write_image(&root.join("assets/宽图.jpg"), 3000, 300, image::ImageFormat::Jpeg);
        write_image(&root.join("assets/小图.png"), 48, 48, image::ImageFormat::Png);

        let mut table = String::from("| 序号 | 名称 | 说明 |\n| --: | --- | --- |\n");
        for i in 1..=80 {
            table.push_str(&format!("| {i} | 条目{i} | 这是第 {i} 行的说明文字，用来检查跨页表格的表头与行高。 |\n"));
        }
        let mut code = String::from("```rust\n");
        for i in 1..=70 {
            code.push_str(&format!("let value_{i} = compute({i}); // 第 {i} 行\n"));
        }
        code.push_str("```");
        let long_paragraph = "长段落测试。".repeat(300);
        let wide_table = "| A | B | C | D | E | F | G | H | I | J |\n|---|---|---|---|---|---|---|---|---|---|\n| 很长的单元格内容一 | 很长的单元格内容二 | 很长的单元格内容三 | 四 | 五 | 六 | 七 | 八 | 九 | 十 |";

        let mut chapters = vec![
            ("a", vec![1], "绪论", format!("{long_paragraph}\n\n一个很长的地址：https://example.com/{0}\n\n行内代码 `C:\\Users\\writer\\Documents\\{0}` 结束。\n\n```\nlet url = \"https://example.com/{0}\";\n```\n\n- [x] 已完成的任务\n- [ ] 未完成的任务\n\n> 第一层引用\n>\n> > 第二层引用\n\n<div>原始 HTML 应显示为文本</div>\n\n小图 ![小图](../assets/小图.png) 在行内。", "a".repeat(200))),
            ("b", vec![1, 1], "长表格", table),
            ("c", vec![1, 2], "长代码", code),
            ("d", vec![2], "图片", "![竖图](../assets/竖图.png)\n\n![宽图](../assets/宽图.jpg)\n\n![缺失](../assets/不存在.png)".to_owned()),
            ("e", vec![2, 1], "宽表格", wide_table.to_owned()),
            ("f", vec![3], "空章节", String::new()),
            ("g", vec![4], "正文内标题", "# 一级\n\n正文\n\n## 二级\n\n### 三级\n\n#### 四级\n\n1. 一\n   1. 一.一\n      1. 一.一.一\n         - 圆点\n2. 二".to_owned()),
        ];
        let mut number = vec![5];
        for depth in 1..=12 {
            chapters.push(("deep", number.clone(), "深层章节", format!("第 {depth} 层")));
            number.push(1);
        }
        let request = RenderRequest {
            title: "压力样例".into(),
            chapters: chapters
                .into_iter()
                .enumerate()
                .map(|(i, (id, number, title, markdown))| RenderChapter {
                    id: format!("{id}{i}"),
                    number,
                    title: title.into(),
                    markdown,
                })
                .collect(),
            ..Default::default()
        };
        let document = build(&request);
        let (docx, report) = docx::export(&document, &root).unwrap();
        assert_eq!(report.missing_images, vec!["../assets/不存在.png".to_owned()]);
        fs::write(out.join("stress.docx"), docx).unwrap();
        let (pdf, _) = pdf::export(&document, &root, pdf::font_store(None), &pdf_layout::PdfLayout::default()).unwrap();
        fs::write(out.join("stress.pdf"), pdf).unwrap();
    }

    /// 大文档耗时测量（1050 章节、约 210 万字）：
    /// `CARGO_PROFILE_RELEASE_LTO=false cargo test --release bench_large_document -- --ignored --nocapture`
    #[test]
    #[ignore]
    fn bench_large_document() {
        use crate::render::{build, RenderChapter, RenderRequest};
        use std::time::Instant;
        let dir = tempfile::TempDir::new().unwrap();
        let paragraph = "长文档写作需要清晰的结构与稳定的输出。".repeat(20);
        let body = vec![paragraph; 5].join("\n\n");
        let mut chapters = Vec::new();
        for p in 1..=50u32 {
            chapters.push(RenderChapter { id: format!("p{p}"), number: vec![p], title: format!("第 {p} 部分"), markdown: body.clone() });
            for s in 1..=20u32 {
                chapters.push(RenderChapter { id: format!("p{p}-{s}"), number: vec![p, s], title: format!("小节 {s}"), markdown: body.clone() });
            }
        }
        let request = RenderRequest {
            title: "大文档".into(),
            chapters,
            ..Default::default()
        };
        let t = Instant::now();
        let document = build(&request);
        println!("parse: {:?}", t.elapsed());
        let t = Instant::now();
        let (docx, _) = docx::export(&document, dir.path()).unwrap();
        println!("docx: {:?} ({} KB)", t.elapsed(), docx.len() / 1024);
        let fonts = pdf::font_store(None);
        let t = Instant::now();
        let (pdf, _) = pdf::export(&document, dir.path(), fonts, &pdf_layout::PdfLayout::default()).unwrap();
        println!("pdf: {:?} ({} KB)", t.elapsed(), pdf.len() / 1024);
    }
}
