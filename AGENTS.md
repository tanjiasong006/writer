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
- UI 可以使用 Domain 的只读数据类型，但业务操作必须通过 Application 用例组织。
- 当前没有实际用途时，不要提前创建 Repository、Service 或接口。

Domain 数据默认使用 readonly，通过生成新数据而不是原地修改来表达状态变化。

外部数据在进入 Domain 前完成结构和类型校验；进入 Domain 后信任类型，但 Domain 仍必须维护自身不变量。

Domain 不包含面向用户的自然语言，用户可见文本由 UI 层负责。

复杂模块可以用 `CONTRACT.md` 定义职责、输入输出和不变量。

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