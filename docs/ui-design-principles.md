# UI / UX 设计准则

适用于所有涉及界面、视觉、布局、交互、拖拽、键盘行为、焦点管理、动画、组件状态的修改。
修改准则前先与产品负责人确认。

规范层次：

- 本文件：全局原则、默认流程与验收标准。
- 组件级规格（如 `src/ui/chapter_tree/ui-spec.md`）：具体尺寸、状态、交互细节。与本文件冲突时以组件级规格为准，
  并把冲突告知产品负责人。
- 编辑器行为不变量见 `src/ui/editor/CONTRACT.md`，编辑环境主题与输出排版的边界见 `docs/decisions.md` 第 5、6、8 节。

## 1. 目标

Writer 追求 Apple 一线桌面生产力软件级别的设计完成度：精确、安静、克制、温和、专业、内容优先、高度一致、
自然的直接操作、完整的状态设计、像素级细节、长时间使用不疲劳。

学习的是 Apple 的标准——restraint、hierarchy、consistency、progressive disclosure、direct manipulation、
interaction clarity、default-state quality、attention to detail——而不是照搬 macOS 的具体视觉元素。
Writer 首先是一款成熟的桌面写作工具，不是网页后台或 SaaS Dashboard，最终应形成自己的设计语言。

## 2. 视觉

- 正文和文档结构永远是视觉主角，UI 主动退到背景。
- 避免 AI 生成 UI / SaaS 风格：滥用卡片、大圆角容器、装饰性渐变、毛玻璃、阴影、大面积强调色、堆叠工具栏、
  无意义图标，以及用装饰掩盖信息层级问题。
- 界面不够好时，优先做减法。

## 3. 信息层级

用户应几乎不需思考就知道：当前在哪里、选中了什么、什么可以操作、操作后发生了什么、下一步最自然的动作是什么。

优先用 spacing、typography、字重、对比度、对齐、位置建立层级，而不是依赖边框、背景块和标签。

## 4. Progressive Disclosure

低频功能不长期占据界面，按场景选择：hover 后出现、选中后出现、context menu、contextual toolbar、
快捷键、application menu。默认界面应尽可能安静。

## 5. 统一视觉参数（design tokens）

字体、字号、行高、spacing、行高度、图标尺寸、点击区域、圆角、边框、分隔线、前景 / 次级前景、hover / selected /
focus / disabled、动画时长与缓动，不应由各组件随意定义孤立数值。

- 新增视觉参数前，先检查现有 token 和周围组件已使用的值能否表达。
- 当前状况：界面 token 集中在 `src/ui/tokens.css`，全局基础样式在 `src/ui/base.css`（应用与 Storybook 共用）；
  正文展示参数在 `ui/editor/editor_theme.ts`（编辑环境主题的默认值，作用于编辑器与全文阅读），
  正文样式在 `ui/editor/document_body.css`（两者共用）。
  编辑环境主题控制写作展示，属于应用偏好；输出排版参数独立，不要求与编辑展示一致。
  正文展示变量与界面 token 可以按职责区分，但不得因此把编辑环境主题保存为项目样式。
- 可以在触及相关区域时逐步把重复数值收拢为共享 token；不要为了"建立设计系统"大规模重写稳定代码。

## 6. 完整状态

交互控件不能只设计默认状态。按组件性质检查：default、hover、pressed、selected、selected + hover、keyboard focus、
disabled、editing、dragging、drop target、loading、error、empty。

- 状态切换不得引起无意义的尺寸跳动、位置移动或闪烁。
- hover 弱于 selected；selected + hover 保持 selected 的主视觉。
- selected（当前对象）与 focus（键盘操作位置）是两个概念，focus 必须可见。

## 7. 桌面交互

除非有明确的产品理由，遵循成熟桌面软件习惯，不创造新的交互语言：

- 单击选中，双击执行合适的直接操作。
- Enter 确认，Esc 取消，Delete 删除，Cmd/Ctrl+Z 撤销，Cmd/Ctrl+Shift+Z 重做，方向键导航。
- 完整键盘导航、context menu、drag & drop、click outside 关闭。
- tooltip 只用于不易理解的图标或被截断的信息。

危险操作可以偏离习惯以防误操作（例如章节树中 Delete 不直接删除章节，见其组件规格）。

## 8. 动画

动画只用于解释变化，不用于装饰：短、轻、自然、可预测、不阻断连续操作。没有动画更自然时就不用。

## 9. 核心区域

### Chapter Tree

最核心的界面之一，目标是第一次使用就能自然理解，而不只是"支持章节树操作"。重点关注：

- 层级一眼可读；编号弱于标题；展开箭头不抢眼；长标题优雅截断。
- hover 轻，selected 明确但克制，selected + hover 稳定。
- rename 自然；键盘导航符合树结构习惯。
- before / inside / after 拖拽语义清晰，深层级拖动时能准确理解最终层级。
- 拖动、新建、删除、移动后的 selection / focus 位置合理。

具体规格见 `src/ui/chapter_tree/ui-spec.md`。

### Editor

正文编辑区永远拥有最高视觉优先级。优先保证：合理的正文宽度与行长、字号、行高、段落节奏、selection、caret、
placeholder，以及 heading、list、quote、code、table、image 的呈现。编辑工具不长期抢夺注意力；Writer 不应看起来像网页 CMS。

## 10. 像素级完成度

2–4px 的不协调也是真实问题。每次 UI 工作结束前至少检查：

- 图标与文字的垂直视觉中心、baseline、左右视觉重量。
- toolbar 高度、panel 边界、章节缩进、行高度、正文内容宽度。
- 按钮点击区域、留白比例。
- hover / selected 强度、focus 可见性、状态切换是否跳动。

功能能用不代表 UI 工作结束。

## 11. 默认流程

1. 阅读相关实现、本文件与对应组件规格。
2. 理解该区域与周围界面的关系。
3. 判断是否有更简单的方案。
4. 优先复用已有设计语言和数值。
5. 小步修改，不无理由重写整个区域。
6. 实际运行并操作（`npm run tauri dev` 或 `npm run storybook`），同步更新 Story 以覆盖关键状态。
7. 检查相关状态：默认、hover、selected、focus、keyboard、dragging、empty 等。
8. 做一次 polish pass（第 10 节）。
9. 再判断任务是否真正完成——测试通过不等于 UI 工作完成。

无法实际运行界面时（例如没有可用的显示环境），在交付说明中明确指出哪些状态未经目视检查。

## 12. 验收标准

结束前逐项自问：

- 是否有 AI-generated UI 感或 SaaS Dashboard 感？
- 是否增加了不必要的元素？能否进一步做减法？
- 是否遗漏状态？是否引入孤立的视觉参数？
- 简单操作是否需要用户额外思考？
- 是否只是"能用"而不是"顺"？
- 是否与 Writer 整体气质一致？

让界面更复杂、却没有明显改善真实使用体验的修改，不应采用。
