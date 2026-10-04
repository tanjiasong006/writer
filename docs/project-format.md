# Writer 项目格式

本文件是 Writer 磁盘格式与保存一致性的长期约束。修改前必须先更新本文件。

## 1. 目录结构

一个 Writer 项目是一个目录：

```text
我的论文/
├─ writer.json            # manifest：文档标题、章节树、ChapterId → 正文文件对应关系
├─ content/
│  ├─ ch_1.md
│  ├─ ch_2.md
│  ├─ ch_2_1.md
│  └─ ch_4_1.md
├─ assets/                # 图片等资源；正文以 ../assets/<name> 相对路径引用
└─ .writer/               # Writer 内部目录：journal、staging、恢复文件、界面状态
```

- 项目目录名、资源文件名均可包含中文等任意 Unicode 字符。
- `.writer/` 以外的内容都应当是用户可以理解、可以被其他 Markdown 工具读取的。

## 2. 正文文件名（产品规则，不可改为 ID 文件名）

**正文文件名由章节当前编号决定，是人类可读的：**

```text
章节编号 1     → content/ch_1.md
章节编号 2.1   → content/ch_2_1.md
章节编号 4.1.3 → content/ch_4_1_3.md
```

- 格式：`ch_` + 各级编号以 `_` 连接 + `.md`，编号从 1 开始、不含前导 0。
- `ChapterId` 是章节稳定的内部身份，**永远不因移动、插入、删除而改变**。
- 章节结构变化导致编号变化时，`ChapterId` 不变，对应正文文件**必须按新编号重命名**。
- manifest 保存 `ChapterId → 当前文件名` 的对应关系。
- 不允许为了简化实现而改用 `ChapterId` 作为文件名。批量重命名的一致性由 persistence 层解决（见第 5 节）。

## 3. manifest：writer.json

```json
{
  "format": "writer-project",
  "version": 1,
  "title": "我的论文",
  "chapters": [
    { "id": "0b6c…", "title": "绪论", "children": [] },
    { "id": "7a1e…", "title": "方法", "children": [
      { "id": "c9d2…", "title": "实验设计", "children": [] }
    ] }
  ],
  "files": {
    "0b6c…": "ch_1.md",
    "7a1e…": "ch_2.md",
    "c9d2…": "ch_2_1.md"
  }
}
```

- `format` 固定为 `writer-project`；`version` 为整数，当前为 1。读到更高版本时拒绝打开，不做猜测。
- `chapters` 就是 Domain 的 `ChapterTree`，加载时必须通过 `validateTree`。节点可以有可选的 `status`
  （`draft` / `revise` / `done`）与 `note`（字符串），没有时省略（docs/decisions.md 第 16 节）；取值非法时拒绝打开。
- `files` 的 key 集合必须与章节树的 id 集合完全一致；value 必须符合第 2 节格式且互不重复。
- 章节深度上限为 32 级（信任边界上的限制，防止异常数据导致递归过深）。
- 章节标题只存在于 manifest 中，正文 Markdown **不重复保存章节标题，也不保存章节编号**。
- JSON 以 UTF-8 保存，不转义中文。
- manifest 只解析、保存已定义的有效字段，未知额外字段不保留，正常保存时从当前项目状态重新生成。
  这是有意的格式策略：旧版 Writer 保存带有未来新增可选字段的项目时可能丢弃这些字段。
  已评估：文档信息与 PDF 排版配置都是可选字段，`version` 保持 1，不承诺旧版 Writer 往返保留（见 3.2）。

### 3.1 取消旧文档样式字段

> 已实施：TS `project_format` 读取时忽略 `style`、生成的 manifest 不含它；Rust 存储层不解释该字段，
> 由测试覆盖旧字段读取忽略、打开不写盘、保存不再写出。

- `writer.json` 不再定义或写出 `style`，其旧子字段 `theme`、`overrides`、`images` 整体取消。
- 读取旧项目时将整个 `style` 作为不使用的额外字段忽略，无论其中值的类型或内容如何，
  不因该字段拒绝打开，也不将其组装到 `WriterDocument` 或输出请求中。
- 打开项目不写盘；在下一次正常项目保存中，生成的 manifest 不再包含 `style`。
  不引入独立清理流程，不批量改写用户项目。
- 不将旧样式迁移为编辑环境偏好、PDF 排版配置或另一套局部布局数据。
  旧样式不再影响显示与输出；正文、图片引用、图注和资源文件保留。
- `version` 保持 1：取消可选样式字段不改变标题、章节树、正文文件对应关系及正文格式。
- 编辑环境主题保存在应用级状态中，遵循 Writer Dev 与正式版隔离，不进入项目 manifest。
- 单张图片尺寸、对齐、位置等信息不进入 manifest、Markdown、资源 metadata 或其他布局存储。
- PDF 文档级排版配置使用新的 `pdf` 字段（见 3.2），不沿用旧 `style`，随正常项目保存事务提交。

### 3.2 文档信息与 PDF 排版配置（已实施）

```json
{
  "format": "writer-project",
  "version": 1,
  "title": "我的论文",
  "subtitle": "副标题",
  "author": "张三",
  "pdf": { "paper": "b5", "toc": false, "chapterNumber": "chapter" },
  "chapters": [],
  "files": {}
}
```

- `subtitle`、`author`：可选字符串，属于文档内容（`docs/pdf-layout.md` 第 2 节）。
  空字符串等同于缺省，保存时不写出。
- `pdf`：可选对象，只保存用户改过的项，按下表的顺序写出；没有改动时不写出。
  改回默认值的项不再保存（之后跟随默认值）。字段与取值（默认值见 `src-tauri/fixtures/pdf_layout_default.json`）：

  | 字段 | 取值 |
  |---|---|
  | `paper` | `"a4"` / `"b5"` / `"a5"` / `"letter"` |
  | `margin` | `"narrow"` / `"normal"` / `"wide"` |
  | `binding` | `"single"` / `"double"` |
  | `bodyFont` / `headingFont` | `"serif"` / `"sans"` |
  | `bodySize` | `10.5` / `12` / `14` |
  | `lineHeight` | `"compact"` / `"normal"` / `"loose"` |
  | `paragraph` | `"indent"` / `"spacing"` |
  | `cover` / `toc` / `chapterNewPage` | 布尔 |
  | `tocDepth` | `1` / `2` / `3` |
  | `chapterNumber` | `"plain"` / `"chapter"` / `"none"` |
  | `header` | `"none"` / `"title"` / `"titleAndChapter"` |
  | `pageNumber` | `"plain"` / `"page"` / `"total"` |
  | `table` | `"threeLine"` / `"grid"` |

- 排版配置有问题不阻止打开项目：`pdf` 不是对象时整体忽略；单个字段类型或取值非法时只忽略该字段
  （回到默认值）；未知字段忽略。忽略的内容在下一次正常保存时不再写出，打开项目不写盘。
- 文档信息字段类型非法时与标题一样拒绝打开（它们是内容，不静默丢弃）。
- 与第 3 节的未知字段策略一致：旧版 Writer 保存时会丢弃这些新字段，这是已接受的限制。

### 3.3 参考文献（docs/decisions.md 第 13 节）

```json
"references": [
  { "id": "k3x9a2b1", "type": "article", "author": "王五", "title": "结构化写作", "container": "编辑学报", "year": "2021" }
]
```

- 可选数组，没有条目时不写出。每项：`id`（字母、数字、`-`、`_`，互不重复）、`type`
  （`book` / `article` / `chapter` / `thesis` / `report` / `web` / `other`）与可选的字符串字段
  `author`（多位作者以分号分隔）、`title`、`container`、`publisher`、`place`、`year`、`volume`、`issue`、`pages`、`url`、`doi`。
  只写出非空字段，未知字段忽略。
- 参考文献是内容：不是数组、标识不合法或重复、类型未知、字段不是字符串时与标题一样拒绝打开。

## 4. 正文内容

- 每个章节恰好对应一个 `.md` 文件，允许为空文件。
- 正文按字节原样保存：Writer 只在用户真正编辑了某章节后才重写该文件；
  单纯因编号变化而重命名时，文件内容按字节复制，不经过任何规范化。
- 正文中的标题（`#`）属于正文内部结构；编辑展示与导出时，章节标题由章节树深度与编号生成。
- 资源引用使用相对于正文文件的路径 `../assets/<name>`，便于其他 Markdown 工具直接打开。
- `content/` 中未被 manifest 引用的文件视为孤儿文件：打开时给出警告，不删除；
  保存时如果某个目标文件名被孤儿文件占用，先把孤儿文件移入 `.writer/recovered/` 再写入。
- `assets/` 中的文件 Writer 不会自动删除（即使不再被引用）。
- 资源导入规则：
  - 支持 PNG / JPG / JPEG / GIF（Word 与 PDF 都能直接嵌入的格式），单个不超过 50 MB。
  - 文件名清洗为只含字母数字（含中文）、`-`、`_`，扩展名小写，因此 Markdown 链接无需转义。
  - 同名且内容相同时复用已有文件；同名不同内容时加 `-1`、`-2` 后缀，绝不覆盖已有资源。
  - 先写 `.writer/asset.tmp` 再 rename 进 `assets/`，不会出现写了一半的图片。
  - 资源导入独立于保存事务：复制完成即落盘；正文中的引用随正文正常保存。
  - 粘贴或拖入的图片（没有源文件路径）按同样规则写入：格式按文件头判断（PNG / JPEG / GIF），
    名称取剪贴板或拖入的文件名（扩展名与内容不符时用内容对应的扩展名，没有名称时为 `image`）；
    其他格式由编辑器先转为 PNG。

### 4.1 章节交叉引用地址

正文中的章节引用写成标准 Markdown 行内链接（产品规则见 `docs/decisions.md` 第 9 节）：

```markdown
详见[2.1 研究方法](writer:chapter/7a1e…)。
仅编号：[2.1](writer:chapter/7a1e…?show=number)
```

- 地址：`writer:chapter/` + 百分号编码的 ChapterId，可选 `?show=number` 或 `?show=title`；
  省略 `show` 表示编号 + 标题，写出时也省略。
- 链接文字是写出时生成的缓存，读取时忽略；写出时按 Markdown 规则转义。
- 以 `writer:`（区分大小写）开头但不符合上述格式、id 解码失败或不在章节树中的地址是失效引用，不使打开失败。
  `show` 为未知值时按默认格式处理。id 的解码是严格的：`%` 后必须是两位十六进制，结果必须是 UTF-8；
  编码部分不得含 `/`、`?`、`#`。查询部分只能是 `show=<值>`。
- 编辑写回时引用地址原样保留（包括格式错误的）；只有更改目标或显示格式时才写出新的规范地址。

### 4.3 文献引用

`[[1]](writer:cite/k3x9a2b1)`：地址是 `writer:cite/` 加条目标识（同 3.3 的规则），链接文字是编号的缓存。
标识不合法时是失效引用。

### 4.2 图表的标识与引用（docs/decisions.md 第 12 节）

```markdown
![研究流程](../assets/流程.png "fig:k3x9a2b1")

Table: 样本构成 {#tbl:p0q8m4c2}

| 组别 | 人数 |
| --- | --- |

如[图 2-1](writer:figure/k3x9a2b1)所示，见[表 2-1](writer:table/p0q8m4c2)。
```

- 图的标识：图片 title 为 `fig:<id>`；表格标题：紧接在表格之前、原文以 `Table: ` 开头的段落，结尾可选 `{#tbl:<id>}`。
- `<id>` 只能是 ASCII 字母、数字、`-`、`_`；不符合时 title 是普通标题、`{#tbl:…}` 是标题文字的一部分。
- 引用地址 `writer:figure/<id>`、`writer:table/<id>`，没有查询部分；id 不合法时是失效引用。编号不写入正文（链接文字是缓存）。

## 5. 保存事务与一致性

一次保存 = 把"内存中的完整文档状态"提交为"磁盘上的完整项目状态"。磁盘上任何时刻都只能处于
**旧状态**或**新状态**之一（崩溃后经恢复），不能出现 manifest 与正文互相矛盾的中间状态。

### 5.1 输入

- 新 manifest（含新的 `files` 对应关系，文件名由新编号推导）。
- 自上次成功保存后内容发生变化的章节正文（按 `ChapterId`）。新章节必须提供正文。
- 旧 `files` 对应关系一律从磁盘上的 `writer.json` 读取，不信任调用方的记忆。

### 5.2 算法：staging + journal + 前滚

```text
0. 若存在未完成的 journal，先执行恢复（5.3）。
1. 清空 .writer/staging/。
2. 准备（不触碰 content/ 与 writer.json，可随时放弃）：
   对新 files 中每个章节，若"内容有变化"或"文件名有变化"或"是新章节"：
     把最终内容写入 .writer/staging/<序号>.md 并 fsync
     （内容有变化 → 写新内容；只是换名 → 按字节复制旧文件）。
   把新 manifest 写入 .writer/staging/writer.json 并 fsync。
   若某目标文件名被孤儿文件占用，把孤儿文件移入 .writer/recovered/。
3. 提交点：原子写入 .writer/journal.json（写临时文件 → fsync → rename → fsync 目录）。
   journal 记录：每个 staging 文件 → 目标文件名；需要删除的旧文件名；staging manifest。
4. 应用（幂等，可重复执行）：
   a. 每个 staging 文件 rename 到 content/<目标名>（覆盖同名旧文件）；
   b. 删除"旧文件名集合 − 新文件名集合"中的文件；
   c. staging manifest rename 为 writer.json；
   d. fsync 相关目录，删除 journal，清空 staging。
```

为什么能处理批量换名：

- 所有需要变化的正文先完整复制到以序号命名的 staging 区，彼此之间、与 content/ 之间都不会重名。
- A/B 互换、整棵子树移动、插入导致后续大量编号后移，在应用阶段都只是"staging → 目标名"的覆盖式 rename；
  目标名在新状态里互不相同，所以不存在覆盖顺序问题。
- 未变化且文件名不变的章节完全不被触碰。

### 5.3 恢复

每次打开或保存前执行：

- 存在 `journal.json` → 事务已提交，按 journal **前滚**第 4 步（已完成的步骤会被跳过）。
- 不存在 journal → 事务未提交，`writer.json` 与 content/ 仍是旧状态，直接清空 staging 残留。
- journal 本身通过原子 rename 写入，因此只会"不存在"或"完整存在"。

### 5.4 失败语义

- 提交点之前失败：磁盘保持旧状态，返回错误。
- 提交点之后失败：磁盘已确定为新状态，只是尚未整理完；返回错误，下次打开或保存时前滚。
- 两种情况下调用方都**不得**把文档标记为已保存（见 `docs/decisions.md` 保存语义）。
  因为每次保存都会重新从磁盘读取旧状态并重发所有未确认的变化，重复保存是安全的。

## 6. 打开项目

1. 执行恢复（5.3）。
2. 读取并校验 `writer.json`（格式、版本、章节树、files 对应关系、深度上限）。
3. 读取每个章节的正文文件；文件缺失或不是合法 UTF-8 时**拒绝打开**并报告具体章节，
   不用空内容替代，避免下次保存把用户数据覆盖为空。
4. 报告孤儿文件（警告，不阻止打开）。

## 7. `.writer/` 内部文件

| 路径 | 用途 |
|---|---|
| `.writer/journal.json` | 已提交但未整理完的保存事务 |
| `.writer/staging/` | 保存事务的临时区 |
| `.writer/recovered/` | 被移走的孤儿文件，从不自动删除 |
| `.writer/ui-state.json` | 选中章节、折叠状态、写作目标与今天的起点字数等界面状态；损坏时忽略，不影响文档 |
| `.writer/lock` | 打开期间持有的操作系统独占锁：同一项目同一时间只能被一个 Writer 进程打开；进程退出时自动释放 |
| `.writer/asset.tmp` | 资源导入时的临时文件 |
| `.writer/snapshots/<毫秒时间戳>.json` | 版本快照（7.1） |
| `.writer/snapshot.tmp` | 写入快照时的临时文件 |

### 7.1 版本快照（2026-10-03 实施，2026-10-04 产品负责人确认）

```json
{ "format": "writer-snapshot", "version": 1, "createdAt": 1790000000000, "label": "初稿", "kind": "manual",
  "manifest": { …writer.json 的内容… }, "contents": { "<ChapterId>": "正文", … } }
```

- 每个版本一个文件，内容是创建时磁盘上已提交的 manifest 与全部正文（不含资源文件：`assets/` 中的文件从不自动删除）。
  文件名是创建时间（Unix 毫秒），只允许数字，同一毫秒内创建时顺延。经临时文件原子写入。
- `kind`：`manual`（用户保存，可命名）、`auto`（每天第一次打开文档时自动留下，最多保留 30 个，最旧的先删除）、
  `before-restore`（恢复其他版本前自动留下的当前版本）。手动与恢复前的版本不自动删除。
- 恢复：读出的版本按打开项目的规则校验，作为一次普通修改提交（正常保存事务），不直接改写项目文件。
- 无法读取的快照在列表中忽略，不影响打开与保存。
