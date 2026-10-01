# pdf_layout

## 职责

PDF 文档级排版配置的类型、默认值、可选值与合并规则（docs/pdf-layout.md 第 4 节）。纯逻辑，不涉及存储格式、UI 或排版实现。

## 数据结构

- `PdfLayout`：完整配置，每一项都是枚举、布尔或分档数值。
- `PdfLayoutSettings`：项目中保存的稀疏配置，只含用户改过的项。

## 输入输出

- `DEFAULT_PDF_LAYOUT`：默认值。与 Rust 共享 `src-tauri/fixtures/pdf_layout_default.json`，两侧测试都读取它。
- `PDF_LAYOUT_OPTIONS` / `PDF_LAYOUT_KEYS`：每一项的可选值与全部项，顺序即界面顺序。
- `isPdfLayoutValue(key, value)`：外部数据校验时使用。
- `resolvePdfLayout(settings)`：合并出完整配置。
- `setPdfLayoutOption(settings, key, value)`：修改一项；等于默认值时删除该项，结果不变时返回同一对象。
- `isDefaultPdfLayout(settings)`：是否没有任何改动。

## 不变量

- `PdfLayoutSettings` 中不出现等于默认值的项（经 `setPdfLayoutOption` 修改时）。
- 纯函数，不修改输入。

## 非目标

配置不属于 `WriterDocument`，不影响编辑展示与 Word；存储格式见 `docs/project-format.md` 第 3.2 节。
