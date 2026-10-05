import type { Meta, StoryObj } from '@storybook/vue3-vite'
import { computed, ref } from 'vue'
import ChapterEditor from './ChapterEditor.vue'
import { chapterRefLabels, elementRefLabels } from './chapter_ref_view.ts'

const meta = {
  title: 'UI/Editor/ChapterEditor',
  component: ChapterEditor,
  parameters: { layout: 'fullscreen' },
  // 模拟上层：把 change 写回 content，行为与工作区一致。
  render: (args) => ({
    components: { ChapterEditor },
    setup() {
      const content = ref(args.content)
      return { args, content, update: (_id: string, text: string) => (content.value = text) }
    },
    template: '<div style="height: 100vh"><ChapterEditor v-bind="args" :content="content" @change="update" /></div>',
  }),
} satisfies Meta<typeof ChapterEditor>

export default meta
type Story = StoryObj<typeof meta>

/** 鼠标勾选 / 取消；Esc 后 Tab 聚焦复选框，Space 切换；正文撤销可恢复状态。 */
export const Checklist: Story = {
  args: {
    chapterId: 'checklist',
    number: '1',
    title: '任务清单',
    content: '- [ ] 待完成的任务\n- [x] 已完成的任务\n- 普通列表项\n  - [ ] 嵌套任务\n  - [x] 嵌套已完成任务\n\n1. [ ] 有序任务\n2. [x] 已完成的有序任务\n',
  },
}

/** 聚焦正文后按 ⌘8 / Ctrl+8，↑↓ 选择列表类型，Enter 执行，Esc 取消。右键菜单中列表归组。 */
export const ListInsertion: Story = {
  args: {
    chapterId: 'list-insertion',
    number: '1',
    title: '插入列表',
    content: '点击此段后按列表快捷键，可以把它转换成列表。\n\n- 普通列表\n- 另一个项目\n\n- [ ] 待办任务\n- [x] 已完成任务\n',
  },
}

/** 常见结构：强调、列表（含嵌套与任务列表）、引用、表格、代码、分隔线（正文不支持标题）。 */
export const Markdown: Story = {
  args: {
    chapterId: 'ch-1',
    number: '2.1',
    title: '实验设计',
    content: [
      '本节介绍**实验设计**与*变量控制*。',
      '',
      '- 对照组',
      '- 实验组',
      '  - 子组 A',
      '',
      '1. 招募',
      '2. 分组',
      '',
      '- [x] 伦理审批',
      '- [ ] 数据采集',
      '',
      '> 所有数据均经过脱敏处理。',
      '',
      '| 组别 | 样本数 |',
      '| --- | ---: |',
      '| 对照组 | 30 |',
      '| **实验组** | 32 |',
      '',
      '---',
      '',
      '行内 `代码`、~~删除线~~ 与[链接](https://example.com)。',
      '',
      '```python',
      'print("hello")',
      '```',
      '',
    ].join('\n'),
  },
}

/** 代码块语法高亮：声明了语言的、没有声明语言（自动识别）的、识别不出语言的（不着色）。 */
export const CodeHighlight: Story = {
  args: {
    chapterId: 'ch-1',
    number: '4.2',
    title: '数据处理',
    content: [
      '清洗脚本：',
      '',
      '```python',
      '# 去掉缺失值并按组汇总',
      'def summarize(rows: list[dict], threshold: float = 0.5) -> dict:',
      '    kept = [r for r in rows if r.get("score") is not None]',
      '    return {"count": len(kept), "ratio": len(kept) / max(len(rows), 1)}',
      '```',
      '',
      '没有声明语言的代码块（用工具栏插入的代码块）自动识别：',
      '',
      '```',
      'SELECT group_id, COUNT(*) AS n',
      'FROM samples',
      "WHERE status = 'valid'",
      'GROUP BY group_id;',
      '```',
      '',
      '```ts',
      'interface Sample {',
      '  readonly id: string',
      '  score: number | null',
      '}',
      'export const isValid = (s: Sample): boolean => s.score !== null && s.score >= 0',
      '```',
      '',
      '识别不出语言时不着色：',
      '',
      '```',
      '样本 A → 样本 B → 汇总',
      '```',
      '',
    ].join('\n'),
  },
}

/**
 * 排版样例：中西文混排的长文。用于检查字体、字号与行长、章节标题、段落节奏、
 * 中西文间距与避头尾、楷体引用、三线表（指针移入或光标在表格中时显示单元格边界）、任务方框。
 */
export const Typography: Story = {
  args: {
    chapterId: 'ch-6',
    number: '3',
    title: '研究方法',
    content: [
      '本章说明研究的数据来源、样本构成与分析方法。研究以上海市徐汇区、杨浦区的12个社区公共空间为对象，于2025年4月至9月间开展实地调查，共回收有效问卷1,286份，访谈记录约14万字。',
      '',
      '数据由三部分组成：问卷调查、行为观察与访谈记录。问卷通过线下拦访发放；行为观察采用Jan Gehl提出的“公共空间—公共生活”（PSPL）调查法，在每个样点记录工作日与周末各两个时段的停留行为。',
      '',
      '1. **问卷调查**：覆盖使用频率、停留时长与满意度评价；',
      '2. **行为观察**：每个时段20分钟，按5分钟间隔快照记录；',
      '3. **半结构访谈**：对象包括居民、街道工作人员与设计师，共38人。',
      '',
      '> 人们在哪里停留、停留多久，比空间被设计成什么样子更能说明它的质量。',
      '',
      '各样点的样本量与受访者基本情况见下表。杨浦区样点的老年受访者占比明显更高，这与该区1990年代以前建成的老旧小区比例较高有关。',
      '',
      '| 样点 | 所在区 | 有效问卷 | 60 岁以上 | 平均停留（分钟） |',
      '| --- | --- | ---: | ---: | ---: |',
      '| 徐家汇公园北入口 | 徐汇 | 142 | 31% | 18.4 |',
      '| 康健街道口袋公园 | 徐汇 | 96 | 47% | 26.1 |',
      '| 殷行路社区广场 | 杨浦 | 118 | 58% | 32.7 |',
      '',
      '定量部分使用Python完成清洗与统计，缺失项超过30%的问卷直接剔除。停留时长上限设为180分钟，超出部分用`clip`截断，完整的编码手册见[附录B](https://example.com)。需要注意的是，**满意度评价**反映的是受访者的*主观感受*，不能直接等同于空间质量。',
      '',
      '```python',
      'df = df[df.isna().mean(axis=1) <= 0.3]',
      'df["stay_min"] = df["stay_min"].clip(upper=180)',
      '```',
      '',
      '---',
      '',
      '- [x] 核对杨浦区样点的问卷编号',
      '- [ ] 补充两位设计师的访谈记录',
      '',
    ].join('\n'),
  },
}

const svgImage = (label: string, width = 480, height = 200) =>
  `data:image/svg+xml,${encodeURIComponent(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}"><rect width="${width}" height="${height}" fill="#e5e7eb"/><text x="${width / 2}" y="${height / 2 + 8}" font-size="20" text-anchor="middle" fill="#374151">${label}</text></svg>`,
  )}`

/**
 * 图片：项目内的图片正常显示（这里用内嵌 SVG 模拟），无法显示的引用显示占位。
 * 图片按统一规则显示：独占一段的图片居中、保持比例、不放大、不超过正文宽度；没有单张图片的尺寸或对齐设置。
 * 点击选中图片后只有选中框；Delete 删除、Cmd+Z 撤销。
 * 独占一段的图片是一个整体：光标不会停在图片旁边；↑ / ↓ 进出图片，最后一张图片之后按 ↓ 即可继续写。
 * 图注（替代文字）显示在图片下方，点击即可编辑，Enter 结束、Esc 放弃；第二张图没有图注，选中它时才显示“添加图注”。
 */
export const Images: Story = {
  args: {
    chapterId: 'ch-4',
    number: '2.2',
    title: '实验装置',
    content: '装置示意：\n\n![图 2-1　实验装置示意](../assets/装置.svg)\n\n![](../assets/曲线.svg)\n\n![缺失的图](../assets/缺失.png)\n',
    resolveImage: (reference: string) =>
      reference.endsWith('装置.svg')
        ? svgImage('实验装置')
        : reference.endsWith('曲线.svg')
          ? svgImage('小图（不放大）', 200, 120)
          : null,
  },
}

/**
 * 宽图、竖长图与表格单元格中的图片：宽图缩到正文宽度；竖长图与行内长图受统一的展示高度上限约束，
 * 保持比例、不裁切，不会无限撑高正文区；单元格中的图片不超过单元格宽度。
 */
export const TallAndWideImages: Story = {
  args: {
    chapterId: 'ch-5',
    number: '1',
    title: '图片展示规则',
    content:
      '![宽图](../assets/宽.svg)\n\n![竖长图](../assets/竖.svg)\n\n| 图 | 说明 |\n| --- | --- |\n| ![长图](../assets/竖.svg) | 单元格中的长图 |\n',
    resolveImage: (reference: string) =>
      reference.endsWith('宽.svg') ? svgImage('宽图', 1600, 300) : svgImage('竖长图', 300, 1600),
  },
}

/** 空章节：显示占位提示。 */
export const Empty: Story = {
  args: { chapterId: 'ch-2', number: '3', title: '结论', content: '' },
}

/** 很长的章节：编辑器自身滚动。 */
export const Long: Story = {
  args: {
    chapterId: 'ch-3',
    number: '4',
    title: '长章节',
    content: Array.from({ length: 200 }, (_, i) => `第 ${i + 1} 段：长文档需要稳定的滚动与输入体验。`).join('\n\n'),
  },
}

/**
 * 章节引用：文字按章节树生成（链接文字只是缓存），失效引用显示原来的文字并以警示样式区分。
 * 点“改名并移动目标章节”模拟章节树变化：引用文字立即更新，正文不变（不产生修改）。
 */
export const ChapterReferences: Story = {
  args: {
    chapterId: 'refs',
    number: '3',
    title: '结果',
    content:
      '如[旧编号](writer:chapter/method)所述，样本见[旧](writer:chapter/data?show=number)节；' +
      '数据处理见[旧](writer:chapter/data?show=title)。\n\n' +
      '**[旧编号](writer:chapter/method)** 中的方法同样适用。\n\n' +
      '被删除章节的引用：[4.2 讨论](writer:chapter/deleted)。\n',
  },
  render: (args) => ({
    components: { ChapterEditor },
    setup() {
      const content = ref(args.content)
      const renamed = ref(false)
      const refLabel = computed(() => {
        const method = { id: 'method', title: renamed.value ? '研究设计' : '研究方法', children: [{ id: 'data', title: '数据来源', children: [] }] }
        const intro = { id: 'intro', title: '绪论', children: [] }
        return chapterRefLabels(renamed.value ? [method, intro] : [intro, method])
      })
      return { args, content, renamed, refLabel, update: (_id: string, text: string) => (content.value = text) }
    },
    template: `
      <div style="height: 100vh; display: flex; flex-direction: column">
        <div style="padding: 8px 16px; font-size: 13px">
          <button type="button" @click="renamed = !renamed">{{ renamed ? '还原章节树' : '改名并移动目标章节' }}</button>
        </div>
        <ChapterEditor v-bind="args" style="flex: 1" :content="content" :ref-label="refLabel" @change="update" />
      </div>`,
  }),
}

/** 脚注：正文中是上标编号，章节末尾列出内容；双击编号或单击列表中的一条编辑，右键“插入脚注…”。 */
export const Footnotes: Story = {
  args: {
    chapterId: 'footnotes',
    number: '2.1',
    title: '研究方法',
    content:
      '本研究采用问卷与访谈相结合的方法[^1]，样本来自三个城市的社区[^2]。\n\n' +
      '| 城市 | 样本量 |\n| --- | --- |\n| 甲市 | 320[^3] |\n\n' +
      '[^1]: 方法设计参考了 *社会调查研究方法* 第三版。\n\n[^2]: 社区的选择标准见附录 A。\n\n[^3]: 剔除无效问卷后的数量。\n',
  },
}

/**
 * 上标与下标：选中文字后用“格式 → 上标 / 下标”设置（两者互斥）。上下标不撑高所在的行，
 * 与脚注编号、文献引用同样大小；可以与粗体、斜体、链接同时使用，也可以在表格、列表中。
 */
export const SuperscriptAndSubscript: Story = {
  args: {
    chapterId: 'scripts',
    number: '3.2',
    title: '处理工艺',
    content:
      '设计处理规模为 5000 m<sup>3</sup>/d，进水 COD 浓度 400 mg/L，出水达到一级 A 标准[^1]。' +
      '曝气池中溶解氧维持在 2 mg/L 左右，污泥浓度约 3.5×10<sup>3</sup> mg/L，' +
      '反应式为 NH<sub>4</sub><sup>+</sup> + 2O<sub>2</sub> → NO<sub>3</sub><sup>-</sup> + H<sub>2</sub>O + 2H<sup>+</sup>。\n\n' +
      '强调中的上下标：**容积负荷 1.2 kg/(m<sup>3</sup>·d)**，*x<sub>i</sub>* 为第 i 个样本，' +
      '误差 ε<sup>*n*</sup> 随迭代次数减小，详见[规范 GB<sub>18918</sub>](https://example.com)。\n\n' +
      '| 指标 | 单位 | 设计值 |\n| --- | --- | --: |\n| 流量 | m<sup>3</sup>/d | 5000 |\n| 面积 | m<sup>2</sup> | 1200 |\n\n' +
      '- CO<sub>2</sub> 排放\n- 10<sup>-6</sup> 量级\n\n' +
      '[^1]: 依据 GB 18918—2002。\n',
  },
}

/** 图表编号：有图注的图在图注前显示“图 2-1”，有标题的表格上方显示“表 2-1　标题”（单击编辑，右键可添加）。 */
export const FiguresAndTables: Story = {
  args: {
    chapterId: 'elements',
    number: '2',
    title: '研究方法',
    elementStart: { chapter: 2, figures: 0, tables: 0 },
    refLabel: elementRefLabels((kind, id) =>
      kind === 'figure' && id === 'flow'
        ? { label: '图 2-1', caption: '研究流程', chapterId: 'elements' }
        : kind === 'table' && id === 'sample'
          ? { label: '表 2-1', caption: '样本构成', chapterId: 'elements' }
          : null,
    ),
    content:
      '研究流程见[图 2-1](writer:figure/flow)，样本构成见[表 2-1](writer:table/sample)。\n\n' +
      '![研究流程](missing-flow.png "fig:flow")\n\n' +
      'Table: 样本构成 {#tbl:sample}\n\n| 组别 | 人数 |\n| --- | --- |\n| 对照 | 30 |\n| 实验 | 32 |\n\n' +
      '| 没有标题的表格 |\n| --- |\n| 不编号 |\n',
  },
}

/** 公式：行内公式随正文排列，公式块居中；无法识别的写法以红色原文显示。双击编辑，输入 $…$ 也会变成公式。 */
export const Formulas: Story = {
  args: {
    chapterId: 'formulas',
    number: '3',
    title: '模型',
    content:
      '设样本均值为 $\\bar{x} = \\frac{1}{n}\\sum_{i=1}^{n} x_i$，方差为 $s^2$。\n\n' +
      '$$\n\\hat{\\beta} = (X^\\top X)^{-1} X^\\top y\n$$\n\n' +
      '写错的公式：$\\notacommand{x}$。\n',
  },
}

/** 化学式（docs/decisions.md 第 22 节）：行内的化学式与离子、化学式块中带条件的方程式。 */
export const Chemistry: Story = {
  args: {
    chapterId: 'chemistry',
    number: '4',
    title: '实验原理',
    content:
      '硫酸铜晶体 $\\ce{CuSO4*5H2O}$ 溶于水，得到 $\\ce{Cu^2+}$ 与 $\\ce{SO4^2-}$；加入 $\\ce{BaCl2}$ 后生成白色沉淀。\n\n' +
      '$$\\ce{Ba^2+ + SO4^2- -> BaSO4 v}$$\n\n' +
      '$$\\ce{2KClO3 ->[MnO2][\\Delta] 2KCl + 3O2 ^}$$\n\n' +
      '$$\\ce{N2 + 3H2 <=>[催化剂][高温高压] 2NH3}$$\n',
  },
}

/** 化学结构式（docs/decisions.md 第 22 节）：语言为 smiles 的代码块画成骨架式；无法识别的以红色原文显示。 */
export const Structures: Story = {
  args: {
    chapterId: 'structures',
    number: '5',
    title: '有机物的结构',
    content:
      '乙醇与乙酸在浓硫酸催化下生成乙酸乙酯：\n\n' +
      '```smiles\nCCO\n```\n\n' +
      '```smiles\nCC(=O)O\n```\n\n' +
      '```smiles\nCCOC(C)=O\n```\n\n' +
      '阿司匹林与咖啡因：\n\n' +
      '```smiles\nCC(=O)OC1=CC=CC=C1C(=O)O\n```\n\n' +
      '```smiles\nCN1C=NC2=C1C(=O)N(C)C(=O)N2C\n```\n\n' +
      '写错的结构式：\n\n```smiles\nC1CC(\n```\n',
  },
}

/** 专注模式：光标所在段落以外的正文与章节标题淡化。 */
export const FocusMode: Story = {
  args: {
    chapterId: 'focus',
    number: '1',
    title: '绪论',
    focusMode: true,
    content:
      '长文档写作需要清晰的结构。章节树让作者随时看到整体，编辑器只显示当前章节。\n\n' +
      '专注模式下，窗口全屏，侧栏与工具栏隐去，只有正在写的这一段保持清晰。\n\n' +
      '移动光标时，清晰的段落随之改变，其余段落淡化，但仍可阅读。\n',
  },
}
