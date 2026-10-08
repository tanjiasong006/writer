import { expect, test } from 'vitest'
import { parseChapter, parseMarkdown, serializeChapter, structureSources } from './markdown.ts'
import { nodes } from './schema.ts'

/** 化学结构式的 Markdown：语言为 smiles 的围栏代码块（docs/decisions.md 第 22 节）。 */

test('语言为 smiles 的围栏代码块是结构式，内容去掉首尾空白；其他代码块不变', () => {
  const doc = parseMarkdown('```smiles\n  CCO \n```\n\n~~~SMILES other\nC=C\n~~~\n\n```js\nCCO\n```')
  expect(doc.child(0).type).toBe(nodes.structure)
  expect(doc.child(0).attrs.smiles).toBe('CCO')
  expect(doc.child(1).type).toBe(nodes.structure)
  expect(doc.child(1).attrs.smiles).toBe('C=C')
  expect(doc.child(2).type).toBe(nodes.code_block)
})

test('列表与引用中的结构式', () => {
  const doc = parseMarkdown('- 乙醇\n\n  ```smiles\n  CCO\n  ```\n\n> ```smiles\n> C\n> ```')
  const found: string[] = []
  doc.descendants((node) => {
    if (node.type === nodes.structure) found.push(node.attrs.smiles)
  })
  expect(found).toEqual(['CCO', 'C'])
})

test('写出为 ```smiles 围栏；未修改的章节原样写回', () => {
  const source = '乙醇：\n\n```smiles\nCCO\n```\n'
  const parsed = parseChapter(source)
  expect(serializeChapter(parsed.doc, parsed.format)).toBe(source)
  const tilde = parseChapter('~~~smiles\nCCO\n~~~\n')
  const edited = tilde.doc.type.create(null, [nodes.structure.create({ smiles: 'C=C' })])
  expect(serializeChapter(edited, tilde.format)).toBe('```smiles\nC=C\n```\n')
})

test('导出前收集正文中全部结构式（SMILES 与条件都相同的去重，按出现顺序）', () => {
  const plain = (smiles: string) => ({ smiles, arrow: '', above: '', below: '', rotate: 0, flip: false })
  const markdown = '```smiles\nCCO\n```\n\n- 项\n\n  ```smiles\n  C\n  ```\n\n```smiles\nCCO\n```\n\n```smiles above="光照"\nCCO\n```\n\n```\nCC\n```'
  expect(structureSources(markdown)).toEqual([plain('CCO'), plain('C'), { ...plain('CCO'), above: '光照' }])
  expect(structureSources('没有结构式')).toEqual([])
})

test('反应式的箭头与条件：读写代码块信息；未修改的原样写回，修改后按统一风格写出', () => {
  const source = '```smiles arrow="<=>" above="催化剂" below="高温、高压"\nN#N.[H][H]>>N\n```\n'
  const parsed = parseChapter(source)
  expect(parsed.doc.child(0).attrs).toEqual({ smiles: 'N#N.[H][H]>>N', arrow: '<=>', above: '催化剂', below: '高温、高压', rotate: 0, flip: false })
  expect(serializeChapter(parsed.doc, parsed.format)).toBe(source)
  const edited = parsed.doc.type.create(null, [
    nodes.structure.create({ smiles: 'CCO>>C=C.O', arrow: '->', above: '浓硫酸 "&" \\ x', below: '' }),
  ])
  const written = serializeChapter(edited, parsed.format)
  expect(written).toBe('```smiles above="浓硫酸 ＂\\&＂ \\\\ x"\nCCO>>C=C.O\n```\n')
  expect(parseChapter(written).doc.child(0).attrs).toEqual({ smiles: 'CCO>>C=C.O', arrow: '', above: '浓硫酸 ＂&＂ \\ x', below: '', rotate: 0, flip: false })
})

test('条件中有反引号时用 ~~~ 围栏', () => {
  const doc = parseMarkdown('x').type.create(null, [nodes.structure.create({ smiles: 'C>>C', above: '`a`' })])
  const written = serializeChapter(doc, parseChapter('').format)
  expect(written).toBe('~~~smiles above="`a`"\nC>>C\n~~~\n')
  expect(parseChapter(written).doc.child(0).attrs.above).toBe('`a`')
})

test('分子的方向：rotate 是整数度数（换算到 0–359），flip 是 true 时翻转；写出时省略 0 与不翻转', () => {
  const attrs = (info: string) => parseChapter(`\`\`\`smiles ${info}\nCCO\n\`\`\`\n`).doc.child(0).attrs
  expect(attrs('rotate="90" flip="true"')).toMatchObject({ rotate: 90, flip: true })
  expect(attrs('ROTATE=" -30 " FLIP="True"')).toMatchObject({ rotate: 330, flip: true })
  expect(attrs('rotate="720"')).toMatchObject({ rotate: 0, flip: false })
  expect(attrs('rotate="45.5" flip="yes"')).toMatchObject({ rotate: 0, flip: false })
  const doc = parseMarkdown('x').type.create(null, [
    nodes.structure.create({ smiles: 'CCO', rotate: 90, flip: true }),
    nodes.structure.create({ smiles: 'CCO', rotate: 0, flip: false }),
  ])
  const written = serializeChapter(doc, parseChapter('').format)
  expect(written).toBe('```smiles rotate="90" flip="true"\nCCO\n```\n\n```smiles\nCCO\n```\n')
  // 方向不同的同一个分子是两张图片。
  expect(structureSources(written)).toHaveLength(2)
})
