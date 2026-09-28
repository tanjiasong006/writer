# 长期风险与结论

本轮评估后决定暂不修改、但需要记录的三项风险。

## 1. 树操作递归，极深文档可能栈溢出（已解决）

> 已处理：Domain 引入 `MAX_CHAPTER_DEPTH = 32`。`validateTree` 超过上限即停止深入并报告
> `depth-exceeded`，移动与插入也不能产生超限的树，因此所有递归遍历的深度都有上界。
> 以下为原始记录。

`chapter_tree`、`chapter_numbering`、拖拽定位与渲染摊平都使用递归遍历。
正常导入的文档深度远达不到引擎调用栈上限，但恶意或异常深的导入数据理论上可能触发
`RangeError: Maximum call stack size exceeded`。

结论：本轮不重写全部树算法。后续接入文件导入时，优先在信任边界上：
- 把 `validateTree` 改成显式栈遍历，或
- 明确并验证一个最大章节深度，超限直接拒绝导入。

## 2. 章节重排只有鼠标拖拽（已解决）

> 已处理：选中章节可用 Alt+Shift+↑ / ↓ / ← / → 上移 / 下移 / 提升 / 降级。
> Application `keyboardMoveIntent` 把方向换算成与拖拽相同的 `MoveIntent`，仍由 `moveChapterTo` 执行，
> 没有新增移动规则。以下为原始记录。

`ChapterTree` 仅实现 HTML5 拖拽，键盘用户无法重排章节。

结论：本轮不实现。做可访问性时，为选中章节增加「上移 / 下移 / 提升 / 降级」快捷键，
复用 Application 的 `moveChapterTo`，不新增移动规则。

## 3. 折叠状态只按章节 ID 保存（已解决）

> 已处理：折叠状态由工作区按项目持有（保存在各项目的 `.writer/ui-state.json`），
> 切换项目时工作区整体重建，不会继承上一份文档的折叠状态。以下为原始记录。

`ChapterTree` 的 `collapsedIds` 只有章节 ID。未来支持多文档时，不同文档里相同的
章节 ID 会继承上一份文档的折叠状态。

结论：本轮只有一个文档来源，不处理。引入多文档后，把折叠状态的键改为
「文档 ID + 章节 ID」，或在切换文档时清空 `collapsedIds`。

## 4. 外部程序修改项目文件

Writer 打开项目时把全部正文读入内存。打开期间如果用其他编辑器修改了某章节的 `content/*.md`：
- 该章节在 Writer 中未被编辑 → 换名时按字节保留磁盘上的版本，外部修改不丢；
- 该章节在 Writer 中也被编辑 → Writer 保存时以自己的版本覆盖。

结论：MVP 不做文件监听与冲突合并。同一时间只在 Writer 中编辑；多个 Writer 进程由项目独占锁（`.writer/lock`）阻止。

## 5. 真实桌面环境的端到端验证

自动化测试覆盖了 Domain / Application / UI（内存存储）与 Rust 存储 / 渲染 / 导出，
但原生对话框、窗口关闭 / 退出流程、Word 中的最终排版需要在真实桌面环境中手动核对。

结论：每次发布前按 `docs/implementation-plan.md` 的"手动验收清单"执行一遍。

## 6. 安装包体积

内嵌 Typst 后 release 可执行文件约 46 MB（gzip 后约 21 MB），其中 Typst 内嵌字体约 9.6 MB。

结论：可接受。若需要缩小，可去掉 `typst-kit` 的 `embedded-fonts`，完全依赖系统拉丁字体。
