//! 化学式（docs/decisions.md 第 22 节）：把公式中的 mhchem 写法 `\ce{…}` 展开为普通 LaTeX，再交给 mitex 转换。
//!
//! 编辑器用 KaTeX 的 mhchem 扩展显示，这里实现其常用子集，结果与 mhchem 相同（不含它为对齐上下标加的
//! `\vphantom` / `\smash` 等细节）：
//! - 化学式：元素符号与小写字母为正体；紧跟在字母或右括号后的数字是下标；`^…` / `_…` 是上 / 下标（`^2-`、`^{2+}`）；
//!   化学式末尾的 `+` / `-` 是电荷（`H+`、`OH-`）；`(aq)`、`(s)`、`(l)`、`(g)` 是物态。
//! - 化学式中的 `-`、`=`、`#` 是单 / 双 / 叁键；`*` 或 `.` 是结晶水等的“·”，之后的数字是系数。
//! - 系数：开头的数字（`2H2O`、`2 H2O`）、分数（`1/2O2`），单独的小写字母（`n H2O`）是斜体变量。
//! - 前置上下标：`^{14}_{6}C`、`^14_6C`，靠右对齐。
//! - 以空白分开的 `+`、`=`、`-` 是运算符；`^` 是气体（↑），`v` 是沉淀（↓）。
//! - 箭头 `->`、`<-`、`<->`、`<-->`、`<=>`（`<=>>`、`<<=>` 同 `<=>`），可带上下方的条件 `->[上][下]`，
//!   条件同样按化学式转换（`->[H2O]`），`{…}` 中是文字。
//! - `{…}` 是原样的文字；`\命令` 及紧跟的 `{…}` 参数原样保留（如 `\Delta`、`\xlongequal{点燃}`）；
//!   中文等非 ASCII 字符是文字。
//!
//! 不认识的结构（括号不配对等）使整个公式转换失败，按公式的规则以原文输出并列入导出报告。

use std::borrow::Cow;

/// 展开 tex 中所有的 `\ce{…}`；没有时原样返回。花括号不配对时为 None。
pub fn expand(tex: &str) -> Option<Cow<'_, str>> {
    if !tex.contains("\\ce") {
        return Some(Cow::Borrowed(tex));
    }
    let chars: Vec<char> = tex.chars().collect();
    let mut out = String::with_capacity(tex.len() * 2);
    let mut i = 0;
    while i < chars.len() {
        if chars[i] == '\\' && chars.get(i + 1) == Some(&'c') && chars.get(i + 2) == Some(&'e')
            && !chars.get(i + 3).is_some_and(|c| c.is_ascii_alphabetic())
        {
            let mut start = i + 3;
            while chars.get(start).is_some_and(|c| c.is_whitespace()) {
                start += 1;
            }
            if chars.get(start) != Some(&'{') {
                return None;
            }
            let end = closing(&chars, start)?;
            let content: String = chars[start + 1..end].iter().collect();
            out.push('{');
            out.push_str(&convert(&content)?);
            out.push('}');
            i = end + 1;
        } else if chars[i] == '\\' {
            // 其他命令（及转义的字符）原样保留。
            out.push('\\');
            i += 1;
            if let Some(&c) = chars.get(i) {
                out.push(c);
                i += 1;
                if c.is_ascii_alphabetic() {
                    while let Some(&c) = chars.get(i).filter(|c| c.is_ascii_alphabetic()) {
                        out.push(c);
                        i += 1;
                    }
                }
            }
        } else {
            out.push(chars[i]);
            i += 1;
        }
    }
    Some(Cow::Owned(out))
}

/// 从 open 处的开括号（`{`、`[`、`(`）找到与它配对的闭括号，跳过 `\` 转义的字符。
fn closing(chars: &[char], open: usize) -> Option<usize> {
    let (left, right) = match chars[open] {
        '{' => ('{', '}'),
        '[' => ('[', ']'),
        _ => ('(', ')'),
    };
    let mut depth = 0usize;
    let mut i = open;
    while i < chars.len() {
        match chars[i] {
            '\\' => i += 1,
            c if c == left => depth += 1,
            c if c == right => {
                depth -= 1;
                if depth == 0 {
                    return Some(i);
                }
            }
            _ => {}
        }
        i += 1;
    }
    None
}

/// `\ce{…}` 的内容 → LaTeX。
fn convert(content: &str) -> Option<String> {
    let chars: Vec<char> = content.chars().collect();
    Converter { chars: &chars, i: 0, out: String::new() }.run()
}

struct Converter<'a> {
    chars: &'a [char],
    i: usize,
    out: String,
}

/// 箭头的写法与对应的命令，较长的写法在前。
const ARROWS: [(&str, &str); 7] = [
    ("<=>>", "xrightleftharpoons"),
    ("<<=>", "xrightleftharpoons"),
    ("<-->", "xtofrom"),
    ("<=>", "xrightleftharpoons"),
    ("<->", "xleftrightarrow"),
    ("->", "xrightarrow"),
    ("<-", "xleftarrow"),
];

impl Converter<'_> {
    fn peek(&self) -> Option<char> {
        self.chars.get(self.i).copied()
    }

    fn at(&self, offset: usize) -> Option<char> {
        self.chars.get(self.i + offset).copied()
    }

    fn starts_with(&self, text: &str) -> bool {
        text.chars().enumerate().all(|(k, c)| self.at(k) == Some(c))
    }

    /// 当前位置之后（跳过空白）是否结束或是空白。
    fn at_boundary(&self, offset: usize) -> bool {
        self.at(offset).is_none_or(char::is_whitespace)
    }

    fn arrow(&self) -> Option<(&'static str, &'static str)> {
        ARROWS.iter().copied().find(|(text, _)| self.starts_with(text))
    }

    fn run(mut self) -> Option<String> {
        while let Some(c) = self.peek() {
            if c.is_whitespace() {
                self.i += 1;
                continue;
            }
            if !self.out.is_empty() {
                self.out.push(' ');
            }
            if let Some((text, command)) = self.arrow() {
                self.i += text.chars().count();
                self.arrow_command(command)?;
            } else if matches!(c, '+' | '=' | '-') && self.at_boundary(1) {
                self.out.push(c);
                self.i += 1;
            } else if c == '^' && self.at_boundary(1) {
                self.out.push_str("\\uparrow");
                self.i += 1;
            } else if c == 'v' && self.at_boundary(1) {
                self.out.push_str("\\downarrow");
                self.i += 1;
            } else {
                self.term()?;
            }
        }
        Some(self.out)
    }

    /// 箭头及其可选的条件 `[上][下]`。
    fn arrow_command(&mut self, command: &str) -> Option<()> {
        let above = self.bracket()?;
        let below = self.bracket()?;
        self.out.push('\\');
        self.out.push_str(command);
        if let Some(below) = below.filter(|text| !text.is_empty()) {
            self.out.push_str(&format!("[{below}]"));
        }
        self.out.push_str(&format!("{{{}}}", above.unwrap_or_default()));
        Some(())
    }

    /// 紧跟的 `[…]`（按化学式转换）；没有时为 Some(None)，不配对时为 None。
    fn bracket(&mut self) -> Option<Option<String>> {
        if self.peek() != Some('[') {
            return Some(None);
        }
        let end = closing(self.chars, self.i)?;
        let inner: String = self.chars[self.i + 1..end].iter().collect();
        self.i = end + 1;
        Some(Some(convert(&inner)?))
    }

    /// 一个不含空白的项：系数与化学式，或命令、文字等。
    fn term(&mut self) -> Option<()> {
        let c = self.peek()?;
        // 单独的小写字母（v 是沉淀，已在之前处理）是斜体的系数变量。
        let coefficient = if c.is_ascii_lowercase() && self.at_boundary(1) {
            self.out.push(c);
            self.i += 1;
            true
        } else {
            self.coefficient()
        };
        if coefficient {
            self.coefficient_gap();
            if self.at_boundary(0) {
                return Some(());
            }
        }
        self.formula()
    }

    /// 系数之后：后面（可能隔着空白）是化学式时加一个小空格。
    fn coefficient_gap(&mut self) {
        let mut j = self.i;
        while self.chars.get(j).is_some_and(|c| c.is_whitespace()) {
            j += 1;
        }
        if self.chars.get(j).is_some_and(|&c| c.is_ascii_alphabetic() || c == '(' || c == '[') {
            // 隔着空白的系数（`2 H2O`）与之后的化学式视为一项。
            if j > self.i && !(self.chars[j] == 'v' && self.chars.get(j + 1).is_none_or(|c| c.is_whitespace())) {
                self.i = j;
            }
            self.out.push_str("\\,");
        }
    }

    /// 开头的数字系数（整数、小数、分数）；没有时返回 false。
    fn coefficient(&mut self) -> bool {
        let start = self.i;
        let digits = |this: &mut Self| {
            let from = this.i;
            while this.peek().is_some_and(|c| c.is_ascii_digit()) {
                this.i += 1;
            }
            this.chars[from..this.i].iter().collect::<String>()
        };
        let whole = digits(self);
        if whole.is_empty() {
            return false;
        }
        if self.peek() == Some('/') && self.at(1).is_some_and(|c| c.is_ascii_digit()) {
            self.i += 1;
            let den = digits(self);
            self.out.push_str(&format!("\\tfrac{{{whole}}}{{{den}}}"));
        } else if self.peek() == Some('.') && self.at(1).is_some_and(|c| c.is_ascii_digit()) {
            self.i += 1;
            let fraction = digits(self);
            self.out.push_str(&format!("{whole}.{fraction}"));
        } else {
            self.out.push_str(&whole);
        }
        self.i > start
    }

    /// 化学式，到空白、结尾或箭头为止。
    fn formula(&mut self) -> Option<()> {
        // 前置上下标（核素）：^{14}_{6}C。
        if self.peek() == Some('^') && self.at(1).is_some_and(|c| c.is_ascii_digit() || c == '{') {
            self.i += 1;
            let mut mass = self.script_digits()?;
            let mut number = String::new();
            if self.peek() == Some('_') {
                self.i += 1;
                number = self.script_digits()?;
            }
            // 上下标靠右对齐（与 mhchem 相同）：较短的一个在左边补上数字宽的空白。
            let (mass_len, number_len) = (mass.chars().count(), number.chars().count());
            if mass_len < number_len {
                mass.insert_str(0, &format!("\\hphantom{{{}}}", "0".repeat(number_len - mass_len)));
            } else if number_len > 0 && number_len < mass_len {
                number.insert_str(0, &format!("\\hphantom{{{}}}", "0".repeat(mass_len - number_len)));
            }
            self.out.push_str(&format!("{{}}^{{{mass}}}"));
            if !number.is_empty() {
                self.out.push_str(&format!("_{{{number}}}"));
            }
        }
        // 上一个输出是否可以带下标（字母或右括号之后的数字是下标）。
        let mut subscriptable = false;
        while let Some(c) = self.peek() {
            if c.is_whitespace() || self.arrow().is_some() {
                break;
            }
            if c.is_ascii_alphabetic() {
                let from = self.i;
                while self.peek().is_some_and(|c| c.is_ascii_alphabetic()) {
                    self.i += 1;
                }
                let letters: String = self.chars[from..self.i].iter().collect();
                self.out.push_str(&format!("\\mathrm{{{letters}}}"));
                subscriptable = true;
            } else if c.is_ascii_digit() && subscriptable {
                let from = self.i;
                while self.peek().is_some_and(|c| c.is_ascii_digit()) {
                    self.i += 1;
                }
                let digits: String = self.chars[from..self.i].iter().collect();
                self.out.push_str(&format!("_{{{digits}}}"));
                subscriptable = false;
            } else if c == '(' && self.state() {
                subscriptable = false;
            } else if c == '(' || c == '[' {
                self.out.push(c);
                self.i += 1;
                subscriptable = false;
            } else if c == ')' || c == ']' {
                self.out.push(c);
                self.i += 1;
                subscriptable = true;
            } else if c == '^' {
                self.i += 1;
                let script = self.charge()?;
                self.out.push_str(&format!("^{{{script}}}"));
                subscriptable = false;
            } else if c == '_' {
                self.i += 1;
                let script = self.script()?;
                self.out.push_str(&format!("_{{{script}}}"));
                subscriptable = false;
            } else if (c == '+' || c == '-') && self.charge_at_end() {
                let from = self.i;
                while self.peek().is_some_and(|c| c == '+' || c == '-') {
                    self.i += 1;
                }
                let charge: String = self.chars[from..self.i].iter().collect();
                self.out.push_str(&format!("^{{{charge}}}"));
                subscriptable = false;
            } else if c == '-' || c == '=' || c == '#' {
                self.out.push_str(match c {
                    '-' => "\\mathord{-}",
                    '=' => "\\mathord{=}",
                    _ => "\\mathord{\\equiv}",
                });
                self.i += 1;
                subscriptable = false;
            } else if c == '*' || c == '.' {
                self.i += 1;
                self.out.push_str("\\,\\cdot\\,");
                if self.coefficient() {
                    self.out.push_str("\\,");
                }
                subscriptable = false;
            } else if c == '{' {
                let end = closing(self.chars, self.i)?;
                let text: String = self.chars[self.i + 1..end].iter().collect();
                self.out.push_str(&format!("\\text{{{text}}}"));
                self.i = end + 1;
                subscriptable = false;
            } else if c == '\\' {
                self.command()?;
                subscriptable = true;
            } else if !c.is_ascii() {
                let from = self.i;
                while self.peek().is_some_and(|c| !c.is_ascii() && !c.is_whitespace()) {
                    self.i += 1;
                }
                let text: String = self.chars[from..self.i].iter().collect();
                self.out.push_str(&format!("\\text{{{text}}}"));
                subscriptable = false;
            } else if c == '}' || c == ']' || c == '&' || c == '%' || c == '~' || c == '$' {
                return None;
            } else {
                self.out.push(c);
                self.i += 1;
                subscriptable = c.is_ascii_digit();
            }
        }
        Some(())
    }

    /// 物态 `(aq)`、`(s)`、`(l)`、`(g)`：前面加一个小空格。不是物态时返回 false。
    fn state(&mut self) -> bool {
        for state in ["(aq)", "(s)", "(l)", "(g)"] {
            if self.starts_with(state) {
                let inner = &state[1..state.len() - 1];
                self.out.push_str(&format!("\\,(\\mathrm{{{inner}}})"));
                self.i += state.len();
                return true;
            }
        }
        false
    }

    /// 化学式末尾的 `+` / `-`（之后是结尾、空白、物态或箭头）是电荷。
    fn charge_at_end(&self) -> bool {
        let mut j = self.i;
        while self.chars.get(j).is_some_and(|&c| c == '+' || c == '-') {
            // `->` 是箭头。
            if self.chars[j] == '-' && self.chars.get(j + 1) == Some(&'>') {
                return j > self.i;
            }
            j += 1;
        }
        match self.chars.get(j) {
            None => true,
            Some(c) if c.is_whitespace() => true,
            Some('(') => true,
            Some('<') => true,
            _ => false,
        }
    }

    /// `^` 之后：`{…}`，或数字加 `+` / `-`（`^2-`），或罗马数字等字母。
    fn charge(&mut self) -> Option<String> {
        if self.peek() == Some('{') {
            return self.braced();
        }
        let from = self.i;
        while self.peek().is_some_and(|c| c.is_ascii_digit()) {
            self.i += 1;
        }
        while self.peek().is_some_and(|c| c == '+' || c == '-') {
            self.i += 1;
        }
        if self.i == from {
            while self.peek().is_some_and(|c| c.is_ascii_alphabetic()) {
                self.i += 1;
            }
            if self.i == from {
                return None;
            }
            let letters: String = self.chars[from..self.i].iter().collect();
            return Some(format!("\\mathrm{{{letters}}}"));
        }
        Some(self.chars[from..self.i].iter().collect())
    }

    /// `_` 之后：`{…}`，或数字 / 字母。
    fn script(&mut self) -> Option<String> {
        if self.peek() == Some('{') {
            return self.braced();
        }
        let from = self.i;
        while self.peek().is_some_and(|c| c.is_ascii_alphanumeric()) {
            self.i += 1;
        }
        (self.i > from).then(|| self.chars[from..self.i].iter().collect())
    }

    /// 前置上下标中的数字：`{…}` 或一串数字。
    fn script_digits(&mut self) -> Option<String> {
        if self.peek() == Some('{') {
            return self.braced();
        }
        let from = self.i;
        while self.peek().is_some_and(|c| c.is_ascii_digit()) {
            self.i += 1;
        }
        (self.i > from).then(|| self.chars[from..self.i].iter().collect())
    }

    /// `{…}` 中的上下标：字母是正体（`^{II}`），命令与其他字符原样（`^{2-}`、`^{\delta+}`）。
    fn braced(&mut self) -> Option<String> {
        let end = closing(self.chars, self.i)?;
        let inner = &self.chars[self.i + 1..end];
        self.i = end + 1;
        let mut out = String::new();
        let mut k = 0;
        while k < inner.len() {
            let from = k;
            if inner[k] == '\\' {
                k += 1;
                while k < inner.len() && inner[k].is_ascii_alphabetic() {
                    k += 1;
                }
                k = (k.max(from + 2)).min(inner.len());
                out.extend(&inner[from..k]);
            } else if inner[k].is_ascii_alphabetic() {
                while k < inner.len() && inner[k].is_ascii_alphabetic() {
                    k += 1;
                }
                out.push_str(&format!("\\mathrm{{{}}}", inner[from..k].iter().collect::<String>()));
            } else {
                out.push(inner[k]);
                k += 1;
            }
        }
        Some(out)
    }

    /// `\命令` 及紧跟的 `{…}` 参数，原样保留。
    fn command(&mut self) -> Option<()> {
        let from = self.i;
        self.i += 1;
        if self.peek().is_some_and(|c| c.is_ascii_alphabetic()) {
            while self.peek().is_some_and(|c| c.is_ascii_alphabetic()) {
                self.i += 1;
            }
        } else if self.peek().is_some() {
            self.i += 1;
        }
        while self.peek() == Some('{') || self.peek() == Some('[') {
            self.i = closing(self.chars, self.i)? + 1;
        }
        self.out.extend(&self.chars[from..self.i]);
        Some(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ce(content: &str) -> String {
        convert(content).unwrap()
    }

    #[test]
    fn formulas_subscripts_and_charges() {
        assert_eq!(ce("H2O"), r"\mathrm{H}_{2}\mathrm{O}");
        assert_eq!(ce("NaCl"), r"\mathrm{NaCl}");
        assert_eq!(ce("(NH4)2SO4"), r"(\mathrm{NH}_{4})_{2}\mathrm{SO}_{4}");
        assert_eq!(ce("[Cu(NH3)4]^2+"), r"[\mathrm{Cu}(\mathrm{NH}_{3})_{4}]^{2+}");
        assert_eq!(ce("SO4^2-"), r"\mathrm{SO}_{4}^{2-}");
        assert_eq!(ce("CO3^{2-}"), r"\mathrm{CO}_{3}^{2-}");
        assert_eq!(ce("Fe^{II}"), r"\mathrm{Fe}^{\mathrm{II}}");
        assert_eq!(ce(r"C^{\delta+}"), r"\mathrm{C}^{\delta+}");
        assert_eq!(ce("H+"), r"\mathrm{H}^{+}");
        assert_eq!(ce("MnO4-"), r"\mathrm{MnO}_{4}^{-}");
        // 与 mhchem 相同：数字是下标，电荷要写 ^。
        assert_eq!(ce("Fe3+"), r"\mathrm{Fe}_{3}^{+}");
        assert_eq!(ce("e-"), r"\mathrm{e}^{-}");
        assert_eq!(ce("Na+(aq)"), r"\mathrm{Na}^{+}\,(\mathrm{aq})");
        assert_eq!(ce("NaCl(s)"), r"\mathrm{NaCl}\,(\mathrm{s})");
        assert_eq!(ce("H2SO4(浓)"), r"\mathrm{H}_{2}\mathrm{SO}_{4}(\text{浓})");
    }

    #[test]
    fn bonds_hydrates_and_nuclides() {
        assert_eq!(ce("CH3-CH3"), r"\mathrm{CH}_{3}\mathord{-}\mathrm{CH}_{3}");
        assert_eq!(ce("CH2=CH2"), r"\mathrm{CH}_{2}\mathord{=}\mathrm{CH}_{2}");
        assert_eq!(ce("CH#CH"), r"\mathrm{CH}\mathord{\equiv}\mathrm{CH}");
        assert_eq!(ce("CuSO4*5H2O"), r"\mathrm{CuSO}_{4}\,\cdot\,5\,\mathrm{H}_{2}\mathrm{O}");
        assert_eq!(ce("CuSO4.5H2O"), r"\mathrm{CuSO}_{4}\,\cdot\,5\,\mathrm{H}_{2}\mathrm{O}");
        assert_eq!(ce("^{14}_{6}C"), r"{}^{14}_{\hphantom{0}6}\mathrm{C}");
        assert_eq!(ce("^235_92U"), r"{}^{235}_{\hphantom{0}92}\mathrm{U}");
        assert_eq!(ce("^{2}H"), r"{}^{2}\mathrm{H}");
    }

    #[test]
    fn coefficients_operators_and_arrows() {
        assert_eq!(
            ce("2H2 + O2 ->[点燃] 2H2O"),
            r"2\,\mathrm{H}_{2} + \mathrm{O}_{2} \xrightarrow{\text{点燃}} 2\,\mathrm{H}_{2}\mathrm{O}"
        );
        assert_eq!(ce("2 H2O"), r"2\,\mathrm{H}_{2}\mathrm{O}");
        assert_eq!(ce("1/2O2"), r"\tfrac{1}{2}\,\mathrm{O}_{2}");
        assert_eq!(ce("n H2O"), r"n\,\mathrm{H}_{2}\mathrm{O}");
        assert_eq!(
            ce("N2 + 3H2 <=>[催化剂][高温高压] 2NH3"),
            r"\mathrm{N}_{2} + 3\,\mathrm{H}_{2} \xrightleftharpoons[\text{高温高压}]{\text{催化剂}} 2\,\mathrm{NH}_{3}"
        );
        assert_eq!(ce("A->B"), r"\mathrm{A} \xrightarrow{} \mathrm{B}");
        assert_eq!(ce("A ->[][\\Delta] B"), r"\mathrm{A} \xrightarrow[\Delta]{} \mathrm{B}");
        assert_eq!(ce("A ->[H2O] B"), r"\mathrm{A} \xrightarrow{\mathrm{H}_{2}\mathrm{O}} \mathrm{B}");
        assert_eq!(ce("A ->[{H2O}] B"), r"\mathrm{A} \xrightarrow{\text{H2O}} \mathrm{B}");
        assert_eq!(ce("A <- B"), r"\mathrm{A} \xleftarrow{} \mathrm{B}");
        assert_eq!(ce("A <-> B"), r"\mathrm{A} \xleftrightarrow{} \mathrm{B}");
        assert_eq!(ce("A <--> B"), r"\mathrm{A} \xtofrom{} \mathrm{B}");
        assert_eq!(ce("Fe + CuSO4 = FeSO4 + Cu"), r"\mathrm{Fe} + \mathrm{CuSO}_{4} = \mathrm{FeSO}_{4} + \mathrm{Cu}");
        assert_eq!(ce("2H+ + 2e- -> H2 ^"), r"2\,\mathrm{H}^{+} + 2\,\mathrm{e}^{-} \xrightarrow{} \mathrm{H}_{2} \uparrow");
        assert_eq!(ce("Ag+ + Cl- -> AgCl v"), r"\mathrm{Ag}^{+} + \mathrm{Cl}^{-} \xrightarrow{} \mathrm{AgCl} \downarrow");
        assert_eq!(
            ce("2H2 + O2 \\xlongequal{点燃} 2H2O"),
            r"2\,\mathrm{H}_{2} + \mathrm{O}_{2} \xlongequal{点燃} 2\,\mathrm{H}_{2}\mathrm{O}"
        );
    }

    #[test]
    fn expands_every_ce_and_leaves_other_latex_alone() {
        assert_eq!(expand(r"x^2").unwrap(), r"x^2");
        assert_eq!(expand(r"\ce{H2O} + \cent \ce {O2}").unwrap(), r"{\mathrm{H}_{2}\mathrm{O}} + \cent {\mathrm{O}_{2}}");
        assert_eq!(expand(r"\Delta H = \ce{CO2}").unwrap(), r"\Delta H = {\mathrm{CO}_{2}}");
        assert!(expand(r"\ce{H2O").is_none());
        assert!(expand(r"\ce H2O").is_none());
        assert!(convert("A ->[B C").is_none());
    }
}
