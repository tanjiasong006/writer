//! 导出字体配置：全项目唯一的字体来源（docs/decisions.md 第 6 节）。
//!
//! 字体按"字体族"配置：衬线（宋体类）、无衬线（黑体类）、楷体、等宽。输出参数（`export::theme`）为每类元素
//! 选择衬线或无衬线；楷体只用于引用，等宽只用于代码。每个字体族是一条有序的候选字体列表：拉丁字体在前、中文字体在后，
//! 覆盖 macOS / Windows / Linux 的常见字体。排版引擎按顺序逐字形回退。
//! 打包字体目录（`bundled_font_dirs`）始终参与查找：随应用打包 Noto Serif / Sans CJK SC（`fonts/README.md`），
//! 它们排在中文候选的最前面，各平台的 PDF 中文排版一致；开发环境没有下载时按本机字体回退。
//! 编辑环境的字体栈独立配置，不以与这里一致为约束。

use super::theme::FontId;

/// 字体族。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FontFamily {
    Serif,
    Sans,
    /// 楷体：只用于引用；本机没有楷体时退回衬线。
    Kai,
    Mono,
}

impl From<FontId> for FontFamily {
    fn from(font: FontId) -> Self {
        match font {
            FontId::Serif => FontFamily::Serif,
            FontId::Sans => FontFamily::Sans,
            FontId::Kai => FontFamily::Kai,
        }
    }
}

/// PDF 排版时使用的候选字体族（按优先级）。
pub fn families(family: FontFamily) -> &'static [&'static str] {
    match family {
        FontFamily::Serif => &[
            // 拉丁
            "Times New Roman",
            "Liberation Serif",
            "DejaVu Serif",
            "Libertinus Serif",
            // 中文：随应用打包的开源字体在前，各平台一致（fonts/README.md）
            "Noto Serif CJK SC",
            // macOS
            "Songti SC",
            "STSong",
            // Windows
            "SimSun",
            "NSimSun",
            // Linux / 开源
            "Source Han Serif SC",
            "Noto Serif SC",
            // 没有宋体时退回黑体类
            "PingFang SC",
            "Microsoft YaHei",
            "Noto Sans CJK SC",
            "Source Han Sans SC",
            "WenQuanYi Micro Hei",
        ],
        FontFamily::Sans => &[
            "Arial",
            "Helvetica",
            "Liberation Sans",
            "DejaVu Sans",
            // 随应用打包的开源字体
            "Noto Sans CJK SC",
            "Heiti SC",
            "STHeiti",
            "PingFang SC",
            "SimHei",
            "Microsoft YaHei",
            "Source Han Sans SC",
            "Noto Sans SC",
            "WenQuanYi Micro Hei",
            "Songti SC",
            "SimSun",
            "Noto Serif CJK SC",
        ],
        FontFamily::Kai => &[
            // 拉丁：楷体自带的西文字形不适合正文，沿用衬线
            "Times New Roman",
            "Liberation Serif",
            "DejaVu Serif",
            "Libertinus Serif",
            // 中文：macOS（按需下载的系统字体）
            "Kaiti SC",
            "STKaiti",
            // Windows
            "KaiTi",
            // Linux
            "AR PL UKai CN",
            // 没有楷体时退回宋体
            "Songti SC",
            "STSong",
            "SimSun",
            "NSimSun",
            "Noto Serif CJK SC",
            "Source Han Serif SC",
            "Noto Serif SC",
            "PingFang SC",
            "Microsoft YaHei",
            "Noto Sans CJK SC",
            "Source Han Sans SC",
            "WenQuanYi Micro Hei",
        ],
        FontFamily::Mono => &[
            "Menlo",
            "Consolas",
            "DejaVu Sans Mono",
            "Liberation Mono",
            "Courier New",
            "PingFang SC",
            "Microsoft YaHei",
            "Noto Sans CJK SC",
            "Songti SC",
            "SimSun",
        ],
    }
}

/// Word 文档中写入的字体名。Word 在打开时自行替换本机没有的字体，
/// 这里选择 Office 自带、跨平台最常见的名字。
pub struct DocxFonts {
    pub latin: &'static str,
    pub east_asia: &'static str,
}

pub fn docx_fonts(family: FontFamily) -> DocxFonts {
    match family {
        FontFamily::Serif => DocxFonts {
            latin: "Times New Roman",
            east_asia: "SimSun",
        },
        FontFamily::Sans => DocxFonts {
            latin: "Arial",
            east_asia: "SimHei",
        },
        FontFamily::Kai => DocxFonts {
            latin: "Times New Roman",
            east_asia: "KaiTi",
        },
        FontFamily::Mono => DocxFonts {
            latin: "Consolas",
            east_asia: "SimSun",
        },
    }
}

/// 用于判断"系统能否显示中文"的探测字符。
pub const CJK_PROBE: char = '中';

/// 随应用打包的字体目录（按优先级）。目前为空目录也无妨，存在即参与查找。
#[cfg(test)]
mod bundled_tests {
    use super::*;

    #[test]
    fn bundled_fonts_lead_the_chinese_candidates() {
        let serif = families(FontFamily::Serif);
        let first_cjk = serif.iter().position(|name| name.contains("CJK") || name.contains("Song")).unwrap();
        assert_eq!(serif[first_cjk], "Noto Serif CJK SC");
        let sans = families(FontFamily::Sans);
        let first_cjk = sans.iter().position(|name| name.contains("CJK") || name.contains("Hei")).unwrap();
        assert_eq!(sans[first_cjk], "Noto Sans CJK SC");
        for family in [FontFamily::Serif, FontFamily::Sans, FontFamily::Kai, FontFamily::Mono] {
            let list = families(family);
            let unique: std::collections::HashSet<_> = list.iter().collect();
            assert_eq!(unique.len(), list.len(), "{family:?} has duplicates");
        }
    }

    /// 下载了打包字体（scripts/fetch-fonts.mjs）时，打包目录中的字体能被找到。
    #[test]
    fn bundled_directory_provides_noto_cjk_when_fetched() {
        let dir = std::path::Path::new(env!("CARGO_MANIFEST_DIR"));
        if !dir.join("fonts/NotoSerifCJKsc-Regular.otf").exists() {
            return;
        }
        let mut found = std::collections::HashSet::new();
        for path in bundled_font_dirs(Some(dir)) {
            for (_, info) in typst_kit::fonts::scan(&path) {
                found.insert(info.family.clone());
            }
        }
        assert!(found.contains("Noto Serif CJK SC") && found.contains("Noto Sans CJK SC"), "{found:?}");
    }
}

pub fn bundled_font_dirs(resource_dir: Option<&std::path::Path>) -> Vec<std::path::PathBuf> {
    resource_dir
        .map(|dir| vec![dir.join("fonts")])
        .unwrap_or_default()
}
