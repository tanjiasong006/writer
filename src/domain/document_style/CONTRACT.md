# document_style

## 职责

整本文档的视觉设计（主题）与图片文件（asset）级布局覆盖的领域模型（docs/decisions.md 第 8 节）。
只有语义参数（字体族、磅值、倍数、语义尺寸），不含 CSS 或任何渲染器实现；纯逻辑，不涉及存储格式与 UI 文案。

## 数据结构

```ts
interface DocumentStyle {          // 持久化的内容（writer.json 的 style）
  readonly theme: ThemeId          // 'book' | 'classic' | 'technical'
  readonly overrides: StyleOverrides   // 主题之上的调整：bodyFont / bodySize / lineHeight / headingFont / heading1-3Size
  readonly images: ImageLayouts    // 图片文件键 → { size?, align? }
}

interface DocumentTheme {          // 解析结果：各渲染器共同的输入
  body       { font, size, lineHeight, paragraphSpacing }
  title      { font, size }
  heading1-3 { font, size, spacingBefore, spacingAfter }   // 第 3 级及更深共用 heading3
  blockquote { font, size }
  codeBlock  { size }
  table      { size }
  image      { size, align, spacing }                       // 图片默认布局
  caption    { font, size }
}
```

单位：字号为磅；`lineHeight` 为相邻基线距离 / 字号；间距为 em。

## 输入输出

- `resolveTheme(style)`：主题 + 调整 → `DocumentTheme`。
- `selectTheme` / `overrideStyle` / `resetOverrides` / `setImageLayout`：返回新样式，结果不变时返回同一对象。
- `effectiveImageLayout(theme, override)`：图片自己的设置优先，其余跟随主题。
- `headingStyle(theme, level)`：第 level 级标题的样式。
- `imageKey(reference)`：图片文件键（正文引用指向的项目内文件，相对项目根目录的规范路径）；项目外 / 远程 / 非法为 null。

## 不变量

- `overrides` 中只有合法值（字体族受控；字号 6–72 磅；行距 1–3），且与主题值不同；与主题相同的值被去掉。
- `images` 中没有空布局；布局按图片文件键记录，不按位置。同一文件的多处出现共享布局（不是元素实例身份）。
- 切换主题清空 `overrides`，保留 `images`。
- 与 Rust `render::theme` / `render::image_key` 语义一致：默认主题共享 `src-tauri/fixtures/default-theme.json`，
  图片文件键共享 `src-tauri/fixtures/image-keys.json`。

## 非目标

不提供按段落或按选中文字的字体、字号、颜色；不提供任意 CSS 或任意像素尺寸；不包含系统字体列表。
