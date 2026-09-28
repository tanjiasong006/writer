import { expect, test } from 'vitest'
import { EditorSelection, EditorState, type StateCommand } from '@codemirror/state'
import {
  appendImage,
  insertCodeBlock,
  insertImage,
  insertTable,
  toggleBold,
  toggleBulletList,
  toggleItalic,
  toggleOrderedList,
  toggleQuote,
} from './markdown_commands.ts'

/** 用 | 标记选区：一个 | 是光标，两个 | 是选区的起止。 */
function stateOf(marked: string): EditorState {
  const from = marked.indexOf('|')
  const to = marked.indexOf('|', from + 1)
  const doc = marked.replaceAll('|', '')
  const selection = to === -1 ? EditorSelection.cursor(from) : EditorSelection.range(from, to - 1)
  return EditorState.create({ doc, selection })
}

/** 执行命令，返回带 | 标记的结果文本。 */
function run(command: StateCommand, marked: string): string {
  let state = stateOf(marked)
  command({ state, dispatch: (tr) => (state = tr.state) })
  const { from, to } = state.selection.main
  const doc = state.doc.toString()
  return from === to
    ? doc.slice(0, from) + '|' + doc.slice(from)
    : doc.slice(0, from) + '|' + doc.slice(from, to) + '|' + doc.slice(to)
}

test('粗体：包裹选区，再次执行取消', () => {
  expect(run(toggleBold, '这是|重点|内容')).toBe('这是**|重点|**内容')
  expect(run(toggleBold, '这是**|重点|**内容')).toBe('这是|重点|内容')
})

test('粗体：无选区时插入成对标记，光标在中间', () => {
  expect(run(toggleBold, '文字|')).toBe('文字**|**')
})

test('斜体', () => {
  expect(run(toggleItalic, '|强调|')).toBe('*|强调|*')
})

test('无序列表：为选中的每一行加前缀，再次执行移除', () => {
  expect(run(toggleBulletList, '|甲\n乙|')).toBe('- |甲\n- 乙|')
  expect(run(toggleBulletList, '|- 甲\n- 乙|')).toBe('|甲\n乙|')
})

test('无序列表：空行不加前缀', () => {
  expect(run(toggleBulletList, '|甲\n\n乙|')).toBe('- |甲\n\n- 乙|')
})

test('有序列表：按行编号；已有无序前缀时替换', () => {
  expect(run(toggleOrderedList, '|甲\n乙\n丙|')).toBe('1. |甲\n2. 乙\n3. 丙|')
  expect(run(toggleOrderedList, '|- 甲\n乙|')).toBe('|1. 甲\n2. 乙|')
})

test('引用', () => {
  expect(run(toggleQuote, '引|用一句话')).toBe('> 引|用一句话')
  expect(run(toggleQuote, '> 引|用')).toBe('引|用')
})

test('代码块：包裹选中文本', () => {
  expect(run(insertCodeBlock, '|print(1)|')).toBe('```\nprint(1)|\n```\n')
})

test('代码块：在段落中间插入时前后留空行', () => {
  expect(run(insertCodeBlock, '前文|后文')).toBe('前文\n\n```\n|\n```\n\n后文')
})

test('表格：插入模板，光标在第一个表头', () => {
  expect(run(insertTable, '段落|')).toBe(
    '段落\n\n| |列 1 | 列 2 | 列 3 |\n| --- | --- | --- |\n|  |  |  |\n|  |  |  |\n',
  )
})

test('表格：在空文档开头插入不加多余空行', () => {
  expect(run(insertTable, '|').startsWith('| |列 1')).toBe(true)
})

test('图片：独立成段；alt 中的方括号被替换', () => {
  expect(run(insertImage('../assets/图1.png', '实验[装置]'), '说明|')).toBe(
    '说明\n\n![实验(装置)](../assets/图1.png)|\n',
  )
})

test('有序列表切回无序列表', () => {
  expect(run(toggleBulletList, '|1. 甲\n2. 乙|')).toBe('|- 甲\n- 乙|')
})

test('appendImage：作为新的一段追加', () => {
  expect(appendImage('', '../assets/a.png', 'a')).toBe('![a](../assets/a.png)\n')
  expect(appendImage('正文', '../assets/a.png', 'a')).toBe('正文\n\n![a](../assets/a.png)\n')
  expect(appendImage('正文\n', '../assets/a.png', 'a')).toBe('正文\n\n![a](../assets/a.png)\n')
})
