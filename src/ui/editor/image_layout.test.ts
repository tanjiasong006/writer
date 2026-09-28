import { afterEach, expect, test } from 'vitest'
import { NodeSelection, Selection, type EditorState } from 'prosemirror-state'
import { EditorView } from 'prosemirror-view'
import { redo, undo, undoDepth } from 'prosemirror-history'
import { THEMES, type ImageLayouts } from '../../domain/document_style/document_style.ts'
import { parseMarkdown, serializeChapter } from './markdown.ts'
import { createEditorState } from './plugins.ts'
import { insertImage } from './commands.ts'
import {
  imageLayoutKey,
  layoutChanges,
  selectedFigure,
  setFigureLayout,
  syncImageLayouts,
} from './image_layout.ts'

const views: EditorView[] = []

afterEach(() => {
  for (const view of views.splice(0)) view.destroy()
})

/** 编辑器视图；transactions 记录每个事务报告的布局修改（相当于 ChapterEditor 发出的 image-layout）。 */
function setup(markdown: string, layouts: ImageLayouts = new Map()) {
  const reported: Array<{ key: string; layout: unknown }> = []
  let state: EditorState = createEditorState(parseMarkdown(markdown))
  const sync = syncImageLayouts(state, layouts, THEMES.book.image)
  if (sync) state = state.apply(sync)
  const view = new EditorView(document.body.appendChild(document.createElement('div')), {
    state,
    dispatchTransaction(tr) {
      view.updateState(view.state.apply(tr))
      reported.push(...layoutChanges(tr))
    },
  })
  views.push(view)
  return { view, reported }
}

/** 选中第 index 张图片（独立成段的 figure 或行内图片，按文档顺序；节点选区）。 */
function selectImage(view: EditorView, index: number): void {
  const positions: number[] = []
  view.state.doc.descendants((node, pos) => {
    if (node.type.name === 'figure' || node.type.name === 'image') positions.push(pos)
  })
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, positions[index])))
}

function figures(view: EditorView): Array<{ size: string | null; align: string | null }> {
  return [...view.dom.querySelectorAll('.is-figure')].map((p) => ({
    size: p.getAttribute('data-image-size'),
    align: p.getAttribute('data-image-align'),
  }))
}

const TWO_IMAGES = '![甲](../assets/甲.png)\n\n![乙](../assets/乙.png)\n'

test('独立成段的图片按图片文件键显示布局；没有设置的跟随主题', () => {
  const { view } = setup(TWO_IMAGES + '\n行内 ![丙](../assets/丙.png) 图\n', new Map([['assets/乙.png', { size: 'small', align: 'left' }]]))
  expect(figures(view)).toEqual([
    { size: 'original', align: 'center' },
    { size: 'small', align: 'left' },
  ])
})

test('在前面插入另一张图片后，布局仍属于原来的图片（不按位置）', () => {
  const { view } = setup(TWO_IMAGES, new Map([['assets/甲.png', { size: 'large' }]]))
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)))
  // 在文档开头插入新图片。
  const tr = view.state.tr.insert(0, view.state.schema.nodes.figure.create({ src: '../assets/新.png' }))
  view.dispatch(tr)
  expect(figures(view).map((f) => f.size)).toEqual(['original', 'large', 'original'])
  // 删除第一张图片后同样不串图。
  view.dispatch(view.state.tr.delete(0, view.state.doc.firstChild!.nodeSize))
  expect(figures(view).map((f) => f.size)).toEqual(['large', 'original'])
})

test('修改布局：文档与选区不变，Markdown 不变，报告给上层', () => {
  const { view, reported } = setup(TWO_IMAGES)
  selectImage(view, 1)
  const { doc, selection } = view.state
  expect(setFigureLayout({ size: 'large' })(view.state, view.dispatch)).toBe(true)
  expect(view.state.doc).toBe(doc)
  expect(view.state.selection.eq(selection)).toBe(true)
  expect(serializeChapter(view.state.doc)).toBe(TWO_IMAGES)
  expect(reported).toEqual([{ key: 'assets/乙.png', layout: { size: 'large' } }])
  expect(figures(view)[1]).toEqual({ size: 'large', align: 'center' })
  expect(selectedFigure(view.state)?.layout).toEqual({ size: 'large', align: 'center' })

  setFigureLayout({ align: 'right' })(view.state, view.dispatch)
  expect(reported.at(-1)).toEqual({ key: 'assets/乙.png', layout: { size: 'large', align: 'right' } })
})

test('撤销 / 重做布局修改：每次修改单独一步，撤销后报告原来的布局', () => {
  const { view, reported } = setup('开头\n\n' + TWO_IMAGES)
  view.dispatch(view.state.tr.insertText('前言', 1))
  selectImage(view, 0)
  setFigureLayout({ size: 'small' })(view.state, view.dispatch)
  setFigureLayout({ size: 'full' })(view.state, view.dispatch)
  expect(figures(view)[0].size).toBe('full')

  undo(view.state, view.dispatch)
  expect(figures(view)[0].size).toBe('small')
  expect(reported.at(-1)).toEqual({ key: 'assets/甲.png', layout: { size: 'small' } })
  undo(view.state, view.dispatch)
  expect(figures(view)[0].size).toBe('original')
  expect(reported.at(-1)).toEqual({ key: 'assets/甲.png', layout: null })
  // 布局修改之前的文字编辑是单独的一步。
  expect(view.state.doc.textContent).toContain('前言')
  redo(view.state, view.dispatch)
  expect(figures(view)[0].size).toBe('small')
  expect(reported.at(-1)).toEqual({ key: 'assets/甲.png', layout: { size: 'small' } })
})

test('选择与主题默认相同的值即恢复跟随主题；没有变化时命令不可用', () => {
  const { view, reported } = setup(TWO_IMAGES, new Map([['assets/甲.png', { size: 'large' }]]))
  selectImage(view, 0)
  expect(setFigureLayout({ align: 'center' })(view.state)).toBe(false)
  setFigureLayout({ size: 'original' })(view.state, view.dispatch)
  expect(reported).toEqual([{ key: 'assets/甲.png', layout: null }])
  expect(imageLayoutKey.getState(view.state)!.layouts.size).toBe(0)
})

test('没有选中独立成段的图片时没有布局可改', () => {
  const { view } = setup('行内 ![丙](../assets/丙.png) 图\n\n![远程](https://example.com/a.png)\n')
  selectImage(view, 0)
  expect(selectedFigure(view.state)).toBeNull()
  selectImage(view, 1)
  expect(selectedFigure(view.state)).toBeNull()
  expect(setFigureLayout({ size: 'small' })(view.state)).toBe(false)
})

test('同步上层的布局与主题：不进入撤销历史，不改变文档', () => {
  const { view, reported } = setup(TWO_IMAGES)
  const depth = undoDepth(view.state)
  const doc = view.state.doc
  const sync = syncImageLayouts(view.state, new Map([['assets/甲.png', { size: 'medium' }]]), THEMES.technical.image)!
  view.dispatch(sync)
  expect(figures(view)).toEqual([
    { size: 'medium', align: 'center' },
    { size: 'large', align: 'center' },
  ])
  expect(view.state.doc).toBe(doc)
  expect(undoDepth(view.state)).toBe(depth)
  expect(reported).toEqual([])
  expect(syncImageLayouts(view.state, new Map([['assets/甲.png', { size: 'medium' }]]), THEMES.technical.image)).toBeNull()
})

test('插入新图片：没有布局记录，使用主题默认', () => {
  const { view } = setup('正文\n')
  const sync = syncImageLayouts(view.state, new Map(), THEMES.technical.image)!
  view.dispatch(sync)
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
  insertImage('../assets/新图.png', '新图')(view.state, view.dispatch)
  expect(figures(view)).toEqual([{ size: 'large', align: 'center' }])
  expect(serializeChapter(view.state.doc)).toBe('正文\n\n![新图](../assets/新图.png)\n')
})
