// @vitest-environment node
import { describe, expect, test } from 'vitest'
import { readdirSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import type { Mark, Node } from 'prosemirror-model'
import { parseChapter, serializeChapter } from './markdown.ts'
import { nodes } from './schema.ts'
import { parseChapterRefAddress } from '../../domain/chapter_reference/chapter_reference.ts'

/**
 * 编辑器 ⇄ Rust 导出的内容契约（docs/decisions.md 第 8 节"编辑与输出的内容契约验证"）。
 *
 * 共享用例在 src-tauri/fixtures/markdown/：`<name>.md` 是原始正文，`<name>.json` 是人工审查的预期语义
 * （中立的 JSON 块树），`<name>.serialized.md` 是编辑器实际写出的正文（golden）。
 * 这里验证：原文解析得到预期语义；写出结果与 golden 一致；golden 再解析仍是预期语义。
 * Rust `render::contract_tests` 读取同一批文件，验证原文与 golden 都得到预期的 IR。
 *
 * golden 只用 `npx vitest run -u` 更新（默认运行只读，缺失也失败，见 vite.config.js 的 update: 'none'），
 * 更新后审查 diff 并再运行 Rust 测试；预期语义（.json）不随实现自动改写。
 */

const dir = fileURLToPath(new URL('../../../src-tauri/fixtures/markdown/', import.meta.url))
const cases = readdirSync(dir)
  .filter((name) => name.endsWith('.md') && !name.endsWith('.serialized.md'))
  .map((name) => name.slice(0, -'.md'.length))
  .sort()

// 中立语义格式：只描述内容与结构，与 ProseMirror / Rust 的内部对象形状无关。
type SemInline =
  | { text: string; marks?: string[] }
  | { code: string; marks?: string[] }
  | { image: string; alt: string; marks?: string[] }
  | { ref: { id: string; show: string } | null; cached: string; marks?: string[] }
  | { footnote: string; marks?: string[] }
  | { break: true }
type SemItem = { task: boolean | null; blocks: SemBlock[] }
type SemBlock =
  | { type: 'paragraph'; inlines: SemInline[] }
  | { type: 'figure'; src: string; alt: string }
  | { type: 'quote'; blocks: SemBlock[] }
  | { type: 'code'; language: string | null; text: string }
  | { type: 'rule' }
  | { type: 'list'; ordered: boolean; start: number; items: SemItem[] }
  | {
      type: 'table'
      align: string[]
      header: SemInline[][]
      rows: SemInline[][][]
    }

const MARK_NAMES: Record<string, string> = { strong: 'strong', em: 'emphasis', strike: 'strike' }

function markNames(marks: readonly Mark[]): string[] {
  const names: string[] = []
  for (const mark of marks) {
    if (mark.type.name === 'link') names.push(`link:${mark.attrs.href as string}`)
    else if (mark.type.name !== 'code') names.push(MARK_NAMES[mark.type.name] ?? mark.type.name)
  }
  return names.sort()
}

function withMarks<T extends object>(value: T, marks: string[]): T {
  return marks.length > 0 ? { ...value, marks } : value
}

function inlines(node: Node): SemInline[] {
  const out: SemInline[] = []
  node.forEach((child) => {
    const marks = markNames(child.marks)
    if (child.type === nodes.hard_break) out.push({ break: true })
    else if (child.type === nodes.chapter_ref) {
      const address = parseChapterRefAddress(child.attrs.href as string)
      const ref = address.kind === 'ref' ? { id: address.id, show: address.show } : null
      out.push(withMarks({ ref, cached: child.attrs.cached as string }, marks))
    } else if (child.type === nodes.footnote) {
      out.push(withMarks({ footnote: (child.attrs.text as string).split(/\s+/).filter(Boolean).join(' ') }, marks))
    } else if (child.type === nodes.image) {
      out.push(withMarks({ image: child.attrs.src as string, alt: child.attrs.alt as string }, marks))
    } else if (child.marks.some((mark) => mark.type.name === 'code')) out.push(withMarks({ code: child.text! }, marks))
    else out.push(withMarks({ text: child.text! }, marks))
  })
  // 相邻、标记相同的文字合并（内部表示可能拆开）。
  const merged: SemInline[] = []
  for (const inline of out) {
    const last = merged.at(-1)
    if (last && 'text' in last && 'text' in inline && String(last.marks) === String(inline.marks)) {
      merged[merged.length - 1] = { ...last, text: last.text + inline.text }
    } else merged.push(inline)
  }
  return merged
}

function blocks(node: Node): SemBlock[] {
  const out: SemBlock[] = []
  node.forEach((child) => out.push(block(child)))
  return out
}

function block(node: Node): SemBlock {
  switch (node.type) {
    case nodes.paragraph:
      return { type: 'paragraph', inlines: inlines(node) }
    case nodes.figure:
      return { type: 'figure', src: node.attrs.src as string, alt: node.attrs.alt as string }
    case nodes.blockquote:
      return { type: 'quote', blocks: blocks(node) }
    case nodes.code_block:
      return { type: 'code', language: (node.attrs.params as string).split(/\s+/)[0] || null, text: node.textContent }
    case nodes.horizontal_rule:
      return { type: 'rule' }
    case nodes.bullet_list:
    case nodes.ordered_list: {
      const items: SemItem[] = []
      node.forEach((item) => items.push({ task: item.attrs.checked as boolean | null, blocks: blocks(item) }))
      const ordered = node.type === nodes.ordered_list
      return { type: 'list', ordered, start: ordered ? (node.attrs.order as number) : 1, items }
    }
    case nodes.table: {
      const rows: SemInline[][][] = []
      const align: string[] = []
      node.forEach((row, _, index) => {
        const cells: SemInline[][] = []
        row.forEach((cell) => cells.push(inlines(cell.inlineContent ? cell : (cell.firstChild ?? cell))))
        if (index === 0) row.forEach((cell) => align.push((cell.attrs.align as string | null) ?? 'none'))
        rows.push(cells)
      })
      return { type: 'table', align, header: rows[0] ?? [], rows: rows.slice(1) }
    }
    default:
      throw new Error(`没有语义投影的节点：${node.type.name}`)
  }
}

function semantics(markdown: string): SemBlock[] {
  return blocks(parseChapter(markdown).doc)
}

describe('共享 Markdown 语义 fixture', () => {
  test('用例存在', () => {
    expect(cases.length).toBeGreaterThan(0)
  })

  for (const name of cases) {
    test(name, async () => {
      const input = readFileSync(`${dir}${name}.md`, 'utf8')
      const expected = JSON.parse(readFileSync(`${dir}${name}.json`, 'utf8')) as { blocks: SemBlock[] }

      expect(semantics(input)).toEqual(expected.blocks)

      const parsed = parseChapter(input)
      const output = serializeChapter(parsed.doc, parsed.format)
      await expect(output).toMatchFileSnapshot(`${dir}${name}.serialized.md`)

      // 往返：写出结果再解析，语义不变，再次写出也不变。
      expect(semantics(output)).toEqual(expected.blocks)
      const again = parseChapter(output)
      expect(serializeChapter(again.doc, again.format)).toBe(output)
    })
  }
})
