import type { ChapterId, ChapterTree } from '../chapter_tree/chapter_tree.ts'
import { defaultDocumentStyle, type DocumentStyle } from '../document_style/document_style.ts'

/**
 * 一份文档：标题、章节树、每个章节的正文，以及整本文档的样式。
 *
 * 不变量：contents 的 key 集合与 tree 中的 id 集合完全一致，每个章节恰好有一份正文（可为空串）。
 * 正文是章节内容本身，不包含章节标题与编号，也不包含任何排版信息（排版属于 style）。
 */
export interface WriterDocument {
  readonly title: string
  readonly tree: ChapterTree
  readonly contents: ReadonlyMap<ChapterId, string>
  readonly style: DocumentStyle
}

export type CreateDocumentReason = 'content-missing' | 'content-orphan'

export type CreateDocumentResult =
  | { readonly ok: true; readonly document: WriterDocument }
  | { readonly ok: false; readonly reason: CreateDocumentReason; readonly chapterId: ChapterId }

/**
 * 由已校验的章节树与正文组装文档，并检查正文与章节一一对应。
 * 用于从存储加载：缺正文或多出正文都说明数据不一致，必须显式失败而不是悄悄补齐或丢弃。
 *
 * 前置条件：tree 是一棵已通过 validateTree 的可信树。
 */
export function createDocument(
  title: string,
  tree: ChapterTree,
  contents: ReadonlyMap<ChapterId, string>,
  style: DocumentStyle = defaultDocumentStyle(),
): CreateDocumentResult {
  const ids = collectIds(tree)
  for (const id of ids) {
    if (!contents.has(id)) return { ok: false, reason: 'content-missing', chapterId: id }
  }
  for (const id of contents.keys()) {
    if (!ids.has(id)) return { ok: false, reason: 'content-orphan', chapterId: id }
  }
  return { ok: true, document: { title, tree, contents, style } }
}

/** 空文档：没有章节，使用默认样式。 */
export function emptyDocument(title: string): WriterDocument {
  return { title, tree: [], contents: new Map(), style: defaultDocumentStyle() }
}

/**
 * 用一棵新树替换文档结构，同步维护正文不变量：
 * 已不在树中的章节（被删除的整棵子树）去掉正文，新出现的章节补空正文，其余正文原样保留。
 *
 * 章节结构操作（新建、移动、删除、重命名）都在 chapter_tree 中完成，这里只负责让正文跟上。
 *
 * 前置条件：tree 是一棵已通过 validateTree 的可信树。
 */
export function replaceTree(document: WriterDocument, tree: ChapterTree): WriterDocument {
  const ids = collectIds(tree)
  const contents = new Map<ChapterId, string>()
  for (const id of ids) contents.set(id, document.contents.get(id) ?? '')
  return { ...document, tree, contents }
}

export type SetContentResult =
  | { readonly ok: true; readonly document: WriterDocument }
  | { readonly ok: false; readonly reason: 'chapter-not-found' }

/** 修改一个章节的正文；内容相同时原样返回同一文档对象。 */
export function setContent(
  document: WriterDocument,
  chapterId: ChapterId,
  content: string,
): SetContentResult {
  const current = document.contents.get(chapterId)
  if (current === undefined) return { ok: false, reason: 'chapter-not-found' }
  if (current === content) return { ok: true, document }
  const contents = new Map(document.contents)
  contents.set(chapterId, content)
  return { ok: true, document: { ...document, contents } }
}

/** 修改文档标题。 */
export function setTitle(document: WriterDocument, title: string): WriterDocument {
  return title === document.title ? document : { ...document, title }
}

/** 修改文档样式；样式不变（同一对象）时原样返回。 */
export function setStyle(document: WriterDocument, style: DocumentStyle): WriterDocument {
  return style === document.style ? document : { ...document, style }
}

/** 章节正文是否有实际内容（不只是空白字符）；找不到章节返回 false。 */
export function hasContent(document: WriterDocument, chapterId: ChapterId): boolean {
  return (document.contents.get(chapterId) ?? '').trim().length > 0
}

function collectIds(tree: ChapterTree): Set<ChapterId> {
  const ids = new Set<ChapterId>()
  const stack = [...tree]
  while (stack.length > 0) {
    const node = stack.pop()!
    ids.add(node.id)
    stack.push(...node.children)
  }
  return ids
}
