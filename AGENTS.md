# Writer

Writer 是一个专注于长文档创作的软件。

核心目标：

> **让复杂长文档的组织、写作和输出变得自然、可靠、低负担。**

## 技术栈

- **Tauri**：桌面应用外壳和系统能力。
- **Vue**：界面和交互。UI 组件默认使用 SFC（.vue）。
- **Rust**：Tauri 后端及需要系统能力、性能或安全边界的逻辑。
- **TypeScript**：前端主要开发语言。
- **测试**：测试统一使用 Vitest；Vue SFC 使用 Vue Test Utils，不为测试单独维护自定义加载器。

## 架构

Writer 的代码按职责分为四层：

1. **UI**：负责界面、交互和视觉反馈。
2. **Application**：负责组织一次完整操作，协调状态、Domain 和 Infrastructure。
3. **Domain**：负责文档、章节、内容等核心对象及其规则。
4. **Infrastructure**：负责文件、存储、导入导出等外部能力。

典型关系：

```text
UI → Application → Domain
          ↓
   Infrastructure ports
```

依赖方向是单向的：UI 依赖 Application，Application 依赖 Domain；Infrastructure 实现 Application 所需的外部能力，不反向控制 Domain。

- Domain 不得依赖 Tauri、文件系统或任何具体存储实现。
- UI 可以使用 Domain 的只读数据类型、常量和无副作用的查询函数（如 `findChapter`、`computeChapterNumbers`、`resolveTheme`），
  但产生新数据的业务操作必须通过 Application 用例组织。
- 当前没有实际用途时，不要提前创建 Repository、Service 或接口。

Domain 数据默认使用 readonly，通过生成新数据而不是原地修改来表达状态变化。

外部数据在进入 Domain 前完成结构和类型校验；进入 Domain 后信任类型，但 Domain 仍必须维护自身不变量。

Domain 不包含面向用户的自然语言，用户可见文本由 UI 层负责。

复杂模块可以用 `CONTRACT.md` 定义职责、输入输出和不变量。

## 长期约束文档

修改相关功能前先阅读，修改约束前先与产品负责人确认：

- `docs/decisions.md`：已确定的产品与技术决策（编辑器、导出、保存语义、字体等）。
- `docs/project-format.md`：项目磁盘格式、正文文件命名规则、保存事务与恢复。
- `docs/implementation-plan.md`：MVP 实施计划与进度。
- `docs/known-risks.md`：已知风险与结论。
- `docs/ui-design-principles.md`：UI / UX 设计准则（视觉、交互、状态、动画、验收标准）。
- `docs/pdf-layout.md`：PDF 默认样式、文档信息与文档级排版配置。

## 开发规则

### 先想清楚再写

先理解需求、现有代码和模块边界，再开始修改。

### 保持简单

只实现当前真正需要的东西，不提前抽象。

按职责拆分代码，不按文件长度拆分。一个文件开始承担多个独立职责时再拆开。

### 一次只解决一个明确问题

尽量把任务拆小，不同时处理多个独立问题。

### 精确修改

只改必要代码，不顺手重构，不做无关修改。

### 用结果验证

新行为要有测试；修复 Bug 先复现，再修复；完成前运行相关测试。

新增或修改可视 UI 组件时，应同步新增或更新对应的 Storybook Story，用于独立查看和人工调试关键状态。

### 开发版与用户数据

开发构建（`npm run tauri dev`）是独立的应用 **Writer Dev**（identifier `io.github.tanjiasong006.writer.dev`），与正式版 Writer
不共享应用级状态（上次打开的项目、界面偏好等，见 `src-tauri/src/app_env.rs`）。项目文件夹里的独占锁按项目路径生效，
两个环境打开同一个真实项目时仍会互相阻止。

**自动化测试、Agent 的界面验证与任何破坏性操作，只能使用测试数据**：临时项目（放在临时目录或 scratchpad）、
fixture、专门的测试项目、Writer Dev 自己的数据。不得打开、修改或删除用户真实的文档；不得读写正式版 Writer 的
应用数据目录。需要让开发版启动时直接打开测试项目，使用 `WRITER_OPEN_PROJECT=<测试项目路径> npm run tauri dev`
（只在开发构建中生效）。

### UI / UX 工作

任何涉及界面、视觉、布局、交互、拖拽、键盘行为、焦点管理、动画或组件状态的修改，**在设计和实现前必须阅读并遵守 `docs/ui-design-principles.md`**，以及对应组件的规格文档（如 `src/ui/chapter_tree/ui-spec.md`）。

测试通过不代表 UI 工作完成，结束前按该文档的默认流程与验收标准检查。