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

test('导出前收集正文中全部结构式的 SMILES（去重，按出现顺序）', () => {
  expect(structureSources('```smiles\nCCO\n```\n\n- 项\n\n  ```smiles\n  C\n  ```\n\n```smiles\nCCO\n```\n\n```\nCC\n```')).toEqual(['CCO', 'C'])
  expect(structureSources('没有结构式')).toEqual([])
})
