# Writer

专注长文档的组织、写作与输出：章节树 + 结构化正文（以 Markdown 保存）+ 自动编号 + Word / PDF 导出。

已确认移除应用内预览，代码尚待实施；全文阅读与页面检查使用导出文件和外部阅读器。

技术栈：Tauri 2 + Vue 3 + TypeScript + Rust。

## 开发

```bash
npm install
npm run tauri dev        # 启动桌面应用
npm run storybook        # 独立查看各 UI 组件
```

## 验证

```bash
npm test                 # Vitest（Domain / Application / UI）
npm run typecheck        # vue-tsc
cd src-tauri
cargo test               # 存储事务（含崩溃矩阵）、渲染、导出
cargo clippy --all-targets
```

手动核对导出样例：

```bash
cd src-tauri
WRITER_SAMPLE_DIR=/tmp/writer-sample cargo test write_sample -- --ignored
# 生成 /tmp/writer-sample/sample.docx 与 sample.pdf
```

## 文档

- `AGENTS.md`：架构分层与开发规则。
- `docs/decisions.md`：已确定的产品与技术决策。
- `docs/project-format.md`：项目磁盘格式、正文文件命名、保存事务与恢复。
- `docs/implementation-plan.md`：MVP 实施计划、进度与手动验收清单。
- `docs/known-risks.md`：已知风险与结论。
- `docs/ui-design-principles.md`：UI / UX 设计准则。
