# chapter_reference

## 职责

章节交叉引用地址的解析与生成（产品规则见 `docs/decisions.md` 第 9 节，格式见 `docs/project-format.md` 第 4.1 节）。
纯逻辑，不涉及 Markdown 解析、UI 或存储。Rust `render::chapter_reference` 按同一规则解析，由共享 Markdown fixture 约束。

## 输入输出

```ts
type ChapterRefShow = 'number-title' | 'number' | 'title'

parseChapterRefAddress(href: string):
  | { kind: 'link' }        // 不以 writer: 开头：普通链接
  | { kind: 'malformed' }   // 以 writer: 开头但不符合格式：失效引用
  | { kind: 'ref'; id: ChapterId; show: ChapterRefShow }

chapterRefAddress(id, show): string   // 规范写法，默认格式省略 ?show
```

## 不变量

- 解析任何输入都不抛出；`writer:` 区分大小写。
- id 严格百分号解码：非法的 `%` 序列或非 UTF-8 结果是 `malformed`；编码部分不得含 `/`、`?`、`#`；解码后不得为空。
- 查询部分只能是 `show=<值>`；未知的值按默认格式处理，其他查询是 `malformed`。
- `parseChapterRefAddress(chapterRefAddress(id, show))` 得到原来的 id 与 show。
- 只判断格式，不判断目标章节是否存在。
