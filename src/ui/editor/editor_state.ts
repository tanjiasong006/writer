import { EditorState, type Extension } from '@codemirror/state'

/**
 * CodeMirror 状态的创建与读取，保证"没有编辑就不改变正文的任何字节"。
 *
 * CodeMirror 默认把 \r\n、\r、\n 都当作换行，读出时统一成 \n。
 * 对全部使用 \r\n 的文件，我们显式指定行分隔符，读回时仍是 \r\n；
 * 混用多种换行的文件保持默认行为：只有被编辑后才会统一成 \n（未编辑的章节不会被写回）。
 */

/** 文件全部使用 \r\n 换行时返回 '\r\n'，否则返回 null（使用默认行为）。 */
export function detectLineSeparator(text: string): '\r\n' | null {
  if (!text.includes('\r\n')) return null
  // 去掉所有 \r\n 后仍有单独的 \r 或 \n，说明是混合换行。
  return /[\r\n]/.test(text.replaceAll('\r\n', '')) ? null : '\r\n'
}

export function createChapterState(text: string, extensions: Extension): EditorState {
  const separator = detectLineSeparator(text)
  return EditorState.create({
    doc: text,
    extensions: separator ? [EditorState.lineSeparator.of(separator), extensions] : extensions,
  })
}

/** 读出正文：使用状态自身的行分隔符，保证与载入时的字节一致。 */
export function readText(state: EditorState): string {
  return state.sliceDoc()
}
