//! 导出字体配置：全项目唯一的字体来源（docs/decisions.md 第 6 节）。
//!
//! 字体按"角色"配置。每个角色是一条有序的候选字体族列表：拉丁字体在前、中文字体在后，
//! 覆盖 macOS / Windows / Linux 的常见字体。排版引擎按顺序逐字形回退。
//! 打包字体目录（`bundled_font_dirs`）始终参与查找，未来放入开源中文字体即可保证各平台一致。

/// 字体角色。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum FontRole {
    Body,
    Heading,
    Mono,
}

/// PDF 排版时使用的候选字体族（按优先级）。
pub fn families(role: FontRole) -> &'static [&'static str] {
    match role {
        FontRole::Body => &[
            // 拉丁
            "Times New Roman",
            "Liberation Serif",
            "DejaVu Serif",
            "Libertinus Serif",
            // 中文：macOS
            "Songti SC",
            "STSong",
            // Windows
            "SimSun",
            "NSimSun",
            // Linux / 开源
            "Noto Serif CJK SC",
            "Source Han Serif SC",
            "Noto Serif SC",
            // 没有宋体时退回黑体类
            "PingFang SC",
            "Microsoft YaHei",
            "Noto Sans CJK SC",
            "Source Han Sans SC",
            "WenQuanYi Micro Hei",
        ],
        FontRole::Heading => &[
            "Arial",
            "Helvetica",
            "Liberation Sans",
            "DejaVu Sans",
            "Heiti SC",
            "STHeiti",
            "PingFang SC",
            "SimHei",
            "Microsoft YaHei",
            "Noto Sans CJK SC",
            "Source Han Sans SC",
            "Noto Sans SC",
            "WenQuanYi Micro Hei",
            "Songti SC",
            "SimSun",
            "Noto Serif CJK SC",
        ],
        FontRole::Mono => &[
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

pub fn docx_fonts(role: FontRole) -> DocxFonts {
    match role {
        FontRole::Body => DocxFonts {
            latin: "Times New Roman",
            east_asia: "SimSun",
        },
        FontRole::Heading => DocxFonts {
            latin: "Arial",
            east_asia: "SimHei",
        },
        FontRole::Mono => DocxFonts {
            latin: "Consolas",
            east_asia: "SimSun",
        },
    }
}

/// 用于判断"系统能否显示中文"的探测字符。
pub const CJK_PROBE: char = '中';

/// 随应用打包的字体目录（按优先级）。目前为空目录也无妨，存在即参与查找。
pub fn bundled_font_dirs(resource_dir: Option<&std::path::Path>) -> Vec<std::path::PathBuf> {
    resource_dir
        .map(|dir| vec![dir.join("fonts")])
        .unwrap_or_default()
}
