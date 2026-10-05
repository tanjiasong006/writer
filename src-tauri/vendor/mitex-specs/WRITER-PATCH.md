# mitex 规格文件（vendored）

来源：Typst 包 `@preview/mitex:0.2.4` 的 `specs/prelude.typ` 与 `specs/latex/standard.typ`（Apache-2.0，见 LICENSE），
与 Rust crate `mitex 0.2.4`（LaTeX → Typst 公式转换）配套：转换结果中的 `mitexsqrt`、`textmath`、`aligned` 等名称由这里的
`mitex-scope` 定义。PDF 导出把这些文件作为虚拟文件提供给 Typst（`export::math`），公式以
`eval(转换结果, mode: "math", scope: mitex-scope)` 求值。

Writer 的修改：

- `latex/standard.typ`：原文导入 `@preview/xarrow:0.2.0`（GPL-3.0，不随应用分发），改为用 Typst 自带的 `math.stretch`
  定义同名的 `xarrow`（`\xrightarrow{…}` 等可伸长箭头），外观略有不同。
- `latex/standard.typ`：可伸长箭头（`arrow-handle`）改为 glob 命令 `{,b}t`，接受可选的下方文字 `\xrightarrow[下]{上}`
  （箭头伸长到上下文字中较宽的一个）；Rust 侧的 mitex 命令规格同步修改（`export::math` 的 `SPEC`）。
  `\xrightarrow` / `\xleftarrow` / `\xRightarrow` / `\xLeftarrow` 用可伸长的 `arrow.r` 等，而不是不能伸长的 `.long` 箭头。
- `latex/standard.typ`：`\KaTeX` 用到的符号 `kai` 在 Typst 0.15 中已不存在，改为直接写文字 “KaTeX”。
- `mod.typ`：补上 Typst 0.15 中已改名的符号（`diff`、`angle.l/r`、`planck.reduce`、`sect`），以 `symbol()` 定义同名兼容符号；只组成 `mitex-scope`，去掉原文用于 mitex-cli 查询的 metadata 输出。

升级 `mitex` crate 时，从同版本的 Typst 包重新取这两个文件并重新应用以上修改，再运行公式相关的导出测试。
