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
- `chapters` 就是 Domain 的 `ChapterTree`，加载时必须通过 `validateTree`。
- `files` 的 key 集合必须与章节树的 id 集合完全一致；value 必须符合第 2 节格式且互不重复。
- 章节深度上限为 32 级（信任边界上的限制，防止异常数据导致递归过深）。
- 章节标题只存在于 manifest 中，正文 Markdown **不重复保存章节标题，也不保存章节编号**。
- JSON 以 UTF-8 保存，不转义中文。

## 4. 正文内容

- 每个章节恰好对应一个 `.md` 文件，允许为空文件。
- 正文按字节原样保存：Writer 只在用户真正编辑了某章节后才重写该文件；
  单纯因编号变化而重命名时，文件内容按字节复制，不经过任何规范化。
- 正文中的标题（`#`）属于正文内部结构；预览与导出时，章节标题由章节树深度与编号生成。
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
| `.writer/ui-state.json` | 选中章节、折叠状态等界面状态；损坏时忽略，不影响文档 |
