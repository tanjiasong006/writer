# document_style（待移除的旧领域模块）

## 状态

本模块原先承担文档主题、主题调整与图片文件级布局覆盖，现有代码尚未移除。
该职责已被 `docs/decisions.md` 第 8 节取代，不再作为目标领域模型或后续扩展依据。

## 目标边界

- `WriterDocument` 只包含标题、章节树、正文，不依赖 `DocumentStyle`。
- 编辑环境主题是应用级偏好，影响写作展示，不进入项目、不影响输出。
- Word 使用规范的默认输出样式，PDF 使用独立的文档级排版配置与自动规则。
- 不提供或持久化单张图片的尺寸、对齐、位置等局部布局，不为此创建元素身份。
- 编辑展示与输出可以复用必要的参数类型或纯函数，但不得要求共享同一个主题实例、主题标识或样式状态。

## 后续代码调整

- 移除 `DocumentStyle`、主题覆盖和图片布局映射，以及 `defaultDocumentStyle`、`isDefaultStyle`、
  `resolveTheme`、`selectTheme`、`overrideStyle`、`resetOverrides`、`setImageLayout` 等旧文档样式操作。
- 移除 Domain 文档的 `style` / `setStyle` 和 Application 会话中的对应修改用例。
- 移除 manifest 的样式解析 / 生成；旧字段读取忽略，正常保存不再写出，不迁移旧值。
- 移除预览专用链路，解除 `DocumentTheme` 作为编辑器与 Word / PDF 共同输入的约束。
  编辑展示、Word 默认输出、PDF 排版分别取得自己的参数；具体新类型与目录按实际职责确定。
- Rust `render::resolve_image` 的资源安全解析继续保留，独立于布局键。
- Rust `image_key` 与布局调用一同删除。TS `imageKey` 还被 `project_format.resolveAssetReference`
  用于计算编辑图片显示路径，不能只删除布局调用就直接删掉函数：先把实际需要的引用解码、
  规范化与越界拒绝逻辑放入资源解析职责，再删除旧 `imageKey` API 和布局键契约。
  保留资源解析的路径安全测试，不以布局移除为由放宽路径限制。
- `fixtures/image-keys.json` 不再作为布局身份共享契约；移除它，仍有用途的路径用例转入资源解析测试。
  `fixtures/default-theme.json` 不再作为编辑与导出必须一致的契约；删除或拆成各场景独立的默认参数 fixture，
  不能保留共享主题值相等的断言。
- 替换旧主题 / 布局契约测试，验证内容与结构完整、旧样式忽略、输出与编辑偏好互不影响。
  不再要求三种场景字体栈、字号、折行或图片比例一致。

## 未决事项

编辑环境主题的可调整项、PDF 配置字段与存储结构另行设计。
在实际需要前不新增 Repository、Service 或泛化配置接口；移除旧样式无需等待新的完整设置系统。
