import { EditorSelection, type EditorState, type StateCommand } from '@codemirror/state'

/**
 * 工具栏的 Markdown 插入命令。都是纯粹的 CodeMirror StateCommand：
 * 只根据当前状态计算一次变更并 dispatch，不依赖 DOM，可以直接单测。
 */

/** 行内标记：有选区时包裹 / 取消包裹；无选区时插入成对标记并把光标放在中间。 */
function toggleInline(mark: string): StateCommand {
  return ({ state, dispatch }) => {
    const changes = state.changeByRange((range) => {
      const before = state.sliceDoc(range.from - mark.length, range.from)
      const after = state.sliceDoc(range.to, range.to + mark.length)
      if (before === mark && after === mark) {
        return {
          changes: [
            { from: range.from - mark.length, to: range.from },
            { from: range.to, to: range.to + mark.length },
          ],
          range: EditorSelection.range(range.from - mark.length, range.to - mark.length),
        }
      }
      return {
        changes: [
          { from: range.from, insert: mark },
          { from: range.to, insert: mark },
        ],
        range: EditorSelection.range(range.from + mark.length, range.to + mark.length),
      }
    })
    dispatch(state.update(changes, { scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}

export const toggleBold = toggleInline('**')
export const toggleItalic = toggleInline('*')

/** 选区覆盖的所有行（至少光标所在行）。 */
function selectedLines(state: EditorState) {
  const range = state.selection.main
  const first = state.doc.lineAt(range.from).number
  const last = state.doc.lineAt(range.to).number
  const lines = []
  for (let n = first; n <= last; n++) lines.push(state.doc.line(n))
  return lines
}

/**
 * 行前缀：所有选中的非空行都已有前缀时移除，否则为缺少的行添加。
 * prefix 接收行序号（从 0 开始），用于有序列表。
 * replaceable 匹配添加时应被替换掉的同类前缀（如在无序与有序列表之间切换）。
 */
function toggleLinePrefix(
  pattern: RegExp,
  prefix: (index: number) => string,
  replaceable: RegExp = pattern,
): StateCommand {
  return ({ state, dispatch }) => {
    const lines = selectedLines(state)
    const content = lines.filter((line) => line.text.trim().length > 0)
    const targets = content.length > 0 ? content : lines
    const allPrefixed = targets.every((line) => pattern.test(line.text))
    const changes = targets.map((line, index) => {
      if (allPrefixed) {
        const match = pattern.exec(line.text)!
        return { from: line.from, to: line.from + match[0].length }
      }
      const existing = replaceable.exec(line.text)
      return existing
        ? { from: line.from, to: line.from + existing[0].length, insert: prefix(index) }
        : { from: line.from, insert: prefix(index) }
    })
    dispatch(state.update({ changes, scrollIntoView: true, userEvent: 'input' }))
    return true
  }
}

const LIST_MARKER = /^(?:[-*+]|\d+[.)]) /

export const toggleBulletList = toggleLinePrefix(/^[-*+] /, () => '- ', LIST_MARKER)
export const toggleOrderedList = toggleLinePrefix(/^\d+[.)] /, (index) => `${index + 1}. `, LIST_MARKER)
export const toggleQuote = toggleLinePrefix(/^> ?/, () => '> ')

/**
 * 在光标处插入一个独立的块：保证块前后各有一个空行，不会粘连在已有段落里。
 * cursorOffset 是光标在块文本中的位置。
 */
function insertBlock(state: EditorState, block: string, cursorOffset: number) {
  const range = state.selection.main
  const before = state.sliceDoc(0, range.from)
  const after = state.sliceDoc(range.to)
  const lead = before.length === 0 || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n'
  const trail = after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : after.length === 0 ? '\n' : '\n\n'
  const insert = lead + block + trail
  return state.update({
    changes: { from: range.from, to: range.to, insert },
    selection: { anchor: range.from + lead.length + cursorOffset },
    scrollIntoView: true,
    userEvent: 'input',
  })
}

/** 代码块：有选区时把选中文本放进代码块，否则插入空代码块并把光标放在内部。 */
export const insertCodeBlock: StateCommand = ({ state, dispatch }) => {
  const selected = state.sliceDoc(state.selection.main.from, state.selection.main.to)
  const block = '```\n' + selected + '\n```'
  dispatch(insertBlock(state, block, 4 + selected.length))
  return true
}

/** 表格：插入 3 列 × 2 行的模板，光标停在第一个表头单元格。 */
export const insertTable: StateCommand = ({ state, dispatch }) => {
  const block = ['| 列 1 | 列 2 | 列 3 |', '| --- | --- | --- |', '|  |  |  |', '|  |  |  |'].join('\n')
  dispatch(insertBlock(state, block, 2))
  return true
}

/** 图片引用的 Markdown；alt 中的方括号会破坏语法，替换为圆括号。 */
export function imageMarkdown(reference: string, alt: string): string {
  const safeAlt = alt.replace(/[[\]]/g, (c) => (c === '[' ? '(' : ')'))
  return `![${safeAlt}](${reference})`
}

/** 把图片作为新的一段追加到正文末尾（章节不在编辑器中时使用）。 */
export function appendImage(text: string, reference: string, alt: string): string {
  const lead = text.length === 0 ? '' : text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n'
  return `${text}${lead}${imageMarkdown(reference, alt)}\n`
}

/**
 * 图片：插入独立一段的图片引用。reference 是正文可用的相对路径（如 ../assets/图.png）。
 * alt 中的方括号会破坏语法，替换为圆括号。
 */
export function insertImage(reference: string, alt: string): StateCommand {
  return ({ state, dispatch }) => {
    const block = imageMarkdown(reference, alt)
    dispatch(insertBlock(state, block, block.length))
    return true
  }
}
