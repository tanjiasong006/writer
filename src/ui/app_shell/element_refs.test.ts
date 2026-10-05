import { afterEach, expect, test } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { Selection, TextSelection } from 'prosemirror-state'
import { createMemoryServices } from '../../testing/memory_services.ts'
import { createDocument } from '../../domain/document/document.ts'
import { PATH, MOD, mountApp, unmountAll, editorView, button } from '../../testing/app_harness.ts'

/** 图表编号与引用（docs/decisions.md 第 12 节）。 */

afterEach(unmountAll)

async function openDocument() {
  const services = createMemoryServices()
  services.shell.enableAppMenu()
  const document = createDocument(
    '论文',
    [
      { id: 'a', title: '绪论', children: [{ id: 'a1', title: '背景', children: [] }] },
      { id: 'b', title: '方法', children: [] },
    ],
    new Map([
      ['a', '见下文。'],
      ['a1', '![研究流程](../assets/流程.png)\n\n![](../assets/无图注.png)'],
      ['b', 'Table: 样本构成\n\n| 组 | 人数 |\n| --- | --- |\n| 甲 | 3 |\n\n![结果](../assets/结果.png "fig:r1")'],
    ]),
  )
  if (!document.ok) throw new Error('fixture')
  services.storage.seed(PATH, document.document)
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  return { services, wrapper }
}

async function save(services: ReturnType<typeof createMemoryServices>) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  return services.storage.committed(PATH)!.contents
}

test('编辑器中按一级章节显示图表编号：有图注 / 标题的才编号', async () => {
  const { wrapper } = await openDocument()
  await wrapper.findAll('.chapter-tree__row')[1].trigger('click') // 背景
  await flushPromises()
  const labels = () => [...editorView(wrapper).dom.querySelectorAll('.editor-figure__caption-label')].map((l) => (l as HTMLElement).hidden ? '' : l.textContent)
  expect(labels()).toEqual(['图 1-1', ''])

  await wrapper.findAll('.chapter-tree__row')[2].trigger('click') // 方法
  await flushPromises()
  expect(editorView(wrapper).dom.querySelector('.table-caption')?.textContent).toBe('表 2-1样本构成')
  expect(labels()).toEqual(['图 2-1'])
})

test('⌘K 中列出图表；引用没有标识的图时给它标识，文字是编号，保存两个章节', async () => {
  const { services, wrapper } = await openDocument()
  const view = editorView(wrapper)
  view.focus()
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
  services.shell.chooseMenuItem('editor:chapter-ref')
  await flushPromises()
  const options = wrapper.findAll('.chapter-ref-picker [role="option"]').map((option) => option.text())
  expect(options.slice(-3)).toEqual(['图 1-1研究流程', '表 2-1样本构成', '图 2-1结果'])
  expect(wrapper.find('.chapter-ref-picker__group').text()).toBe('图表')

  const input = wrapper.find('.chapter-ref-picker input')
  await input.setValue('流程')
  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(editorView(wrapper).dom.querySelector('.chapter-ref')?.textContent).toBe('图 1-1')

  const contents = await save(services)
  const id = /fig:([a-z0-9]{8})/.exec(contents.get('a1')!)![1]
  expect(contents.get('a1')).toBe(`![研究流程](../assets/流程.png "fig:${id}")\n\n![](../assets/无图注.png)`)
  expect(contents.get('a')).toBe(`见下文。[图 1-1](writer:figure/${id})`)
})

test('引用表格：标识写在标题中；表格编号变化后引用文字随之更新，⌘ + 单击前往所在章节', async () => {
  const { services, wrapper } = await openDocument()
  const view = editorView(wrapper)
  view.focus()
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
  services.shell.chooseMenuItem('editor:chapter-ref')
  await flushPromises()
  const input = wrapper.find('.chapter-ref-picker input')
  await input.setValue('样本')
  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  let contents = await save(services)
  const id = /\{#tbl:([a-z0-9]{8})\}/.exec(contents.get('b')!)![1]
  expect(contents.get('b')!.startsWith(`Table: 样本构成 {#tbl:${id}}\n\n| 组 | 人数 |`)).toBe(true)

  // 方法前面插入一个一级章节：表格变成“表 3-1”，引用文字立即更新。
  const ref = () => editorView(wrapper).dom.querySelector('.chapter-ref')!
  expect(ref().textContent).toBe('表 2-1')
  services.shell.chooseMenuItem('chapter:new')
  await flushPromises()
  await wrapper.find('.chapter-tree__rename-input').trigger('keydown', { key: 'Escape' })
  await wrapper.findAll('.chapter-tree__row')[0].trigger('click')
  await flushPromises()
  expect(ref().textContent).toBe('表 3-1')

  ref().dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...MOD }))
  await flushPromises()
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('3方法')
  contents = await save(services)
  expect(contents.get('a')).toBe(`见下文。[表 2-1](writer:table/${id})`)
})

test('表格标题：右键菜单添加、单击标题编辑，清空即去掉标题', async () => {
  const { services, wrapper } = await openDocument()
  await wrapper.findAll('.chapter-tree__row')[2].trigger('click')
  await flushPromises()
  const view = editorView(wrapper)
  view.focus()
  // 光标放进表格的单元格，打开右键菜单。
  let cell = -1
  view.state.doc.descendants((node, pos) => {
    if (cell < 0 && node.type.name === 'table_cell') cell = pos + 1
    return cell < 0
  })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cell)))
  const popover = () => document.querySelector<HTMLTextAreaElement>('.text-popover__input')
  ;(wrapper.findComponent({ name: 'ChapterEditor' }).vm as unknown as { openMenuAtCaret(): Promise<void> }).openMenuAtCaret()
  await flushPromises()
  await button(wrapper, '编辑表格标题…').trigger('click')
  await flushPromises()
  expect(popover()!.value).toBe('样本构成')
  popover()!.value = '样本的构成'
  popover()!.dispatchEvent(new Event('input'))
  popover()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await flushPromises()
  expect((await save(services)).get('b')!.startsWith('Table: 样本的构成\n\n|')).toBe(true)

  editorView(wrapper).dom.querySelector('.table-caption')!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  await flushPromises()
  popover()!.value = ''
  popover()!.dispatchEvent(new Event('input'))
  popover()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
  await flushPromises()
  expect((await save(services)).get('b')!.startsWith('| 组 | 人数 |')).toBe(true)
  expect(editorView(wrapper).dom.querySelector('.table-caption')).toBeNull()
})

test('表注：右键菜单添加、显示在表格下方、单击编辑，清空即去掉表注', async () => {
  const { services, wrapper } = await openDocument()
  await wrapper.findAll('.chapter-tree__row')[2].trigger('click')
  await flushPromises()
  const view = editorView(wrapper)
  view.focus()
  let cell = -1
  view.state.doc.descendants((node, pos) => {
    if (cell < 0 && node.type.name === 'table_cell') cell = pos + 1
    return cell < 0
  })
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, cell)))
  const popover = () => document.querySelector<HTMLTextAreaElement>('.text-popover__input')
  const note = () => editorView(wrapper).dom.querySelector('.table-note')
  const type = async (text: string) => {
    popover()!.value = text
    popover()!.dispatchEvent(new Event('input'))
    popover()!.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }))
    await flushPromises()
  }
  expect(note()).toBeNull()
  ;(wrapper.findComponent({ name: 'ChapterEditor' }).vm as unknown as { openMenuAtCaret(): Promise<void> }).openMenuAtCaret()
  await flushPromises()
  await button(wrapper, '添加表注…').trigger('click')
  await flushPromises()
  expect(popover()!.value).toBe('')
  await type('注：数据来自问卷。')
  expect(note()?.textContent).toBe('注：数据来自问卷。')
  // 表注紧跟在表格之后，在下一段之前。
  expect(note()!.previousElementSibling?.tagName).toBe('TABLE')
  expect((await save(services)).get('b')).toBe(
    'Table: 样本构成\n\n| 组 | 人数 |\n| --- | --- |\n| 甲 | 3 |\n\nTable-note: 注：数据来自问卷。\n\n![结果](../assets/结果.png "fig:r1")',
  )

  note()!.dispatchEvent(new MouseEvent('click', { bubbles: true, detail: 1 }))
  await flushPromises()
  expect(popover()!.value).toBe('注：数据来自问卷。')
  await type('')
  expect(note()).toBeNull()
  expect((await save(services)).get('b')!.includes('Table-note')).toBe(false)
})

test('全文阅读中同样显示图表编号', async () => {
  const { wrapper } = await openDocument()
  await button(wrapper, '全文阅读').trigger('click')
  await flushPromises()
  const reader = wrapper.find('.document-reader')
  expect(reader.findAll('.editor-figure__caption-label').map((l) => l.text())).toEqual(['图 1-1', '图 2-1'])
  expect(reader.find('.table-caption').text()).toBe('表 2-1样本构成')
})

test('全文阅读中表注显示在表格下方', async () => {
  const services = createMemoryServices()
  const document = createDocument(
    '论文',
    [{ id: 'a', title: '方法', children: [] }],
    new Map([['a', '| 组 | 人数 |\n| --- | --- |\n| 甲 | 3 |\n\nTable-note: 注：数据来自问卷。']]),
  )
  if (!document.ok) throw new Error('fixture')
  services.storage.seed(PATH, document.document)
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  await button(wrapper, '全文阅读').trigger('click')
  await flushPromises()
  const note = wrapper.find('.document-reader .table-note')
  expect(note.text()).toBe('注：数据来自问卷。')
  expect(note.element.previousElementSibling?.tagName).toBe('TABLE')
})
