import { afterEach, expect, test, vi } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { NodeSelection, Selection, TextSelection } from 'prosemirror-state'
import { undo, undoDepth } from 'prosemirror-history'
import type { EditorView } from 'prosemirror-view'
import { createMemoryServices } from '../../testing/memory_services.ts'
import { createDocument } from '../../domain/document/document.ts'
import { DEFAULT_PDF_LAYOUT } from '../../domain/pdf_layout/pdf_layout.ts'
import ChapterEditor from '../editor/ChapterEditor.vue'
import DocumentReader from '../reader/DocumentReader.vue'
import {
  PATH,
  MOD,
  tree,
  seededServices,
  mountApp,
  unmountApp,
  unmountAll,
  rowTexts,
  menuItem,
  documentMenu,
  exportPdf,
  saveState,
  renameDocument,
  documentTitle,
  button,
  editorView,
  typeAtEnd,
  editorText,
  appMenuItem,
  pressInEditor,
  focusedChapter,
} from '../../testing/app_harness.ts'

/**
 * 工作区（以整个应用挂载，经内存服务）：章节、正文编辑、菜单栏与快捷键、插入图片、导出、侧栏与焦点。
 * 应用级流程见 App.test.ts。
 */

afterEach(unmountAll)

test('界面状态：选中章节与折叠状态随项目恢复，失效的章节被忽略', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  services.shell.uiStates.set(
    PATH,
    JSON.stringify({ version: 1, selectedId: 'b', collapsedIds: ['a', 'ghost'] }),
  )
  const wrapper = await mountApp(services)

  expect(rowTexts(wrapper)).toEqual(['1绪论', '2方法'])
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('2方法')
})

test('界面状态变化后写回项目', async () => {
  vi.useFakeTimers()
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)

  await wrapper.findAll('.chapter-tree__row')[2].trigger('click') // 方法
  await vi.advanceTimersByTimeAsync(600)
  expect(JSON.parse(services.shell.uiStates.get(PATH)!)).toEqual({
    version: 1,
    selectedId: 'b',
    collapsedIds: [],
  })
})

test('Cmd/Ctrl+S 保存结构修改', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)

  await wrapper.find('.chapter-tree__add').trigger('click') // 在选中章节（绪论）之后新建
  await wrapper.find('.chapter-tree__rename-input').setValue('相关工作')
  await wrapper.find('.chapter-tree__rename-input').trigger('keydown', { key: 'Enter' })
  expect(saveState(wrapper)).toBe('dirty')

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()

  const committed = services.storage.committed(PATH)!
  expect(committed.tree.map((node) => node.title)).toEqual(['绪论', '相关工作', '方法'])
  expect(saveState(wrapper)).toBe('saved')
})

test('保存失败：状态显示失败原因并可重试', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await wrapper.find('.chapter-tree__add').trigger('click')
  services.storage.failNext({ code: 'io', operation: 'write', path: 'x', message: '磁盘已满' })
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()

  expect(wrapper.find('.save-status').text()).toContain('保存失败')
  expect(wrapper.find('.workspace__save-error').text()).toContain('磁盘已满')

  await button(wrapper, '重试').trigger('click')
  await flushPromises()
  expect(saveState(wrapper)).toBe('saved')
})

test('删除章节：空白章节直接删除，有正文的章节先确认并说明包含正文', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)

  await wrapper.findAll('.chapter-tree__row')[1].find('.chapter-tree__more').trigger('click')
  await button(wrapper, '删除').trigger('click')
  await flushPromises()
  expect(wrapper.find('.chapter-manager__confirm').exists()).toBe(false)
  expect(rowTexts(wrapper)).toEqual(['1绪论', '2方法'])

  await wrapper.findAll('.chapter-tree__row')[1].find('.chapter-tree__more').trigger('click')
  await button(wrapper, '删除').trigger('click')
  expect(wrapper.find('.chapter-manager__confirm').text()).toContain('包含正文')
})

test('删除正在编辑的章节：编辑器切到相邻章节，之后新建章节正常', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('1绪论')

  await wrapper.findAll('.chapter-tree__row')[0].find('.chapter-tree__more').trigger('click')
  await button(wrapper, '删除').trigger('click')
  await button(wrapper, '删除').trigger('click')
  await flushPromises()
  expect(rowTexts(wrapper)).toEqual(['1方法'])
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('1方法')

  await wrapper.find('.chapter-tree__add').trigger('click')
  await flushPromises()
  expect(wrapper.find('.chapter-manager__error').exists()).toBe(false)
  await wrapper.find('.chapter-tree__rename-input').trigger('keydown', { key: 'Escape' })
  expect(rowTexts(wrapper)).toEqual(['1方法', '2未命名章节'])
})

test('修改文档标题：在工具栏的文档名处原地重命名，Esc 放弃、Enter 确认，焦点回到文档名', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await documentMenu(wrapper, '重命名')
  await flushPromises()
  const input = wrapper.find<HTMLInputElement>('.document-title__input')
  expect(document.activeElement).toBe(input.element)
  await input.setValue('不要')
  await input.trigger('keydown', { key: 'Escape' })
  await flushPromises()
  expect(documentTitle(wrapper)).toBe('毕业论文')
  expect(document.activeElement).toBe(wrapper.find('.document-title__button').element)

  await renameDocument(wrapper, '  新标题  ')
  expect(documentTitle(wrapper)).toBe('新标题')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  expect(services.storage.committed(PATH)!.title).toBe('新标题')
})

test('导出 PDF：携带项目中保存的排版配置（与默认值合并后的完整配置）', async () => {
  const services = seededServices()
  services.storage.seed(PATH, services.storage.committed(PATH)!, { toc: false, paper: 'b5' })
  services.shell.lastProjectPath = PATH
  services.shell.exportPath = '/导出/毕业论文.pdf'
  const wrapper = await mountApp(services)
  await flushPromises()

  await exportPdf(wrapper)

  expect(services.output.exports).toHaveLength(1)
  expect(services.output.exports[0].pdfLayout).toEqual({ ...DEFAULT_PDF_LAYOUT, toc: false, paper: 'b5' })
})

test('导出 PDF：先打开排版设置；修改后按"导出…"保存设置并按新设置导出；取消则不导出也不修改', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  services.shell.exportPath = '/导出/毕业论文.pdf'
  const wrapper = await mountApp(services)
  await flushPromises()
  const dialog = () => wrapper.find('.pdf-layout')
  const choose = (label: string, option: string) =>
    dialog()
      .find(`[role="radiogroup"][aria-label="${label}"]`)
      .findAll('[role="radio"]')
      .find((radio) => radio.text() === option)!
      .trigger('click')

  await button(wrapper, '导出').trigger('click')
  await button(wrapper, '导出为 PDF…').trigger('click')
  await flushPromises()
  expect(dialog().exists()).toBe(true)
  await choose('纸张', 'B5')
  await flushPromises()
  // 样张取当前文档开头，按草稿设置重新排版。
  expect(services.output.previews.map((p) => p.pdfLayout.paper)).toEqual(['a4', 'b5'])
  expect(services.output.previews[0].request.title).toBe('毕业论文')
  expect(dialog().findAll('.preview__page')).toHaveLength(1)
  await button(wrapper, '取消').trigger('click')
  await flushPromises()
  expect(dialog().exists()).toBe(false)
  expect(services.output.exports).toHaveLength(0)
  expect(saveState(wrapper)).not.toBe('dirty')

  await button(wrapper, '导出').trigger('click')
  await button(wrapper, '导出为 PDF…').trigger('click')
  await flushPromises()
  await choose('纸张', 'B5')
  await button(wrapper, '导出…').trigger('click')
  await flushPromises()
  expect(dialog().exists()).toBe(false)
  expect(services.output.exports).toHaveLength(1)
  expect(services.output.exports[0].pdfLayout.paper).toBe('b5')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  expect(services.storage.committedPdfLayout(PATH)).toEqual({ paper: 'b5' })
})

test('菜单栏"PDF 排版设置…"：完成后只保存设置，不导出；"导出为 PDF…"同样先打开设置', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  services.shell.enableAppMenu()
  const wrapper = await mountApp(services)
  await flushPromises()

  expect(appMenuItem(services, 'file:pdf-layout').label).toBe('PDF 排版设置…')
  services.shell.chooseMenuItem('file:pdf-layout')
  await flushPromises()
  const cover = wrapper.findAll('.pdf-layout label').find((label) => label.text() === '封面')!.find('input')
  await cover.setValue(false)
  await button(wrapper, '完成').trigger('click')
  await flushPromises()
  expect(wrapper.find('.pdf-layout').exists()).toBe(false)
  expect(services.output.exports).toHaveLength(0)
  expect(saveState(wrapper)).toBe('dirty')
  services.shell.chooseMenuItem('file:save')
  await flushPromises()
  expect(services.storage.committedPdfLayout(PATH)).toEqual({ cover: false })

  services.shell.chooseMenuItem('file:export-pdf')
  await flushPromises()
  expect(wrapper.find('.pdf-layout').exists()).toBe(true)
  const selected = wrapper.findAll('.pdf-layout label').find((label) => label.text() === '封面')!.find('input')
  expect((selected.element as HTMLInputElement).checked).toBe(false)
})

test('文档信息：从文档名菜单打开，Enter 完成后保存副标题与作者；Esc 放弃，焦点回到原处', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  const titleButton = wrapper.find<HTMLButtonElement>('.document-title__button').element
  titleButton.focus()

  await documentMenu(wrapper, '文档信息…')
  await flushPromises()
  const dialog = () => wrapper.find('.document-info')
  expect(dialog().exists()).toBe(true)
  const inputs = dialog().findAll<HTMLInputElement>('input')
  expect(inputs.map((input) => input.element.value)).toEqual(['毕业论文', '', ''])
  expect(document.activeElement).toBe(inputs[0].element)

  await inputs[1].setValue('不要')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }))
  await flushPromises()
  expect(dialog().exists()).toBe(false)
  expect(saveState(wrapper)).not.toBe('dirty')
  expect(document.activeElement).toBe(titleButton)

  await documentMenu(wrapper, '文档信息…')
  await flushPromises()
  const fields = dialog().findAll<HTMLInputElement>('input')
  await fields[0].setValue('   ')
  await fields[1].setValue('  一项研究  ')
  await fields[2].setValue('张三')
  await dialog().trigger('submit')
  await flushPromises()
  expect(dialog().exists()).toBe(false)
  // 空标题保留原标题。
  expect(documentTitle(wrapper)).toBe('毕业论文')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  expect(services.storage.committed(PATH)).toMatchObject({ title: '毕业论文', subtitle: '一项研究', author: '张三' })
})

test('文档信息：菜单栏"文件"中也有入口，打开时 Tab 只在对话框内循环', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  services.shell.enableAppMenu()
  const wrapper = await mountApp(services)

  expect(appMenuItem(services, 'file:info').label).toBe('文档信息…')
  services.shell.chooseMenuItem('file:info')
  await flushPromises()
  const controls = wrapper.findAll('.document-info input, .document-info button')
  expect(controls).toHaveLength(5)
  ;(controls[4].element as HTMLElement).focus()
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab' }))
  expect(document.activeElement).toBe(controls[0].element)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Tab', shiftKey: true }))
  expect(document.activeElement).toBe(controls[4].element)
})

test('导出菜单：点击别处或按 Esc 关闭', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)

  await button(wrapper, '导出').trigger('click')
  expect(wrapper.find('[role="menu"]').exists()).toBe(true)
  await wrapper.find('.workspace__backdrop').trigger('click')
  expect(wrapper.find('[role="menu"]').exists()).toBe(false)

  await button(wrapper, '导出').trigger('click')
  await wrapper.find('[role="menu"]').trigger('keydown', { key: 'Escape' })
  expect(wrapper.find('[role="menu"]').exists()).toBe(false)
})

test('编辑正文：选中章节的正文显示在编辑器中，修改后保存到该章节', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()

  expect(wrapper.find('.chapter-editor__heading').text()).toBe('1绪论')
  expect(editorText(wrapper)).toBe('引言')

  typeAtEnd(editorView(wrapper), '：长文档写作')
  await flushPromises()
  expect(saveState(wrapper)).toBe('dirty')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()

  expect(services.storage.committed(PATH)!.contents.get('a')).toBe('引言：长文档写作')
  expect([...services.storage.saves[0].changed]).toEqual(['a'])
})

test('切换章节后编辑只写入当前章节', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()

  typeAtEnd(editorView(wrapper), '1')
  await wrapper.findAll('.chapter-tree__row')[2].trigger('click') // 方法
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('2方法')
  expect(editorText(wrapper)).toBe('方法正文')
  typeAtEnd(editorView(wrapper), '2')

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  const contents = services.storage.committed(PATH)!.contents
  expect(contents.get('a')).toBe('引言1')
  expect(contents.get('b')).toBe('方法正文2')
  expect(contents.get('a1')).toBe('')
})

test('自动保存：停止输入后自动写盘', async () => {
  vi.useFakeTimers()
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await vi.advanceTimersByTimeAsync(0)

  typeAtEnd(editorView(wrapper), '！')
  await vi.advanceTimersByTimeAsync(1500)
  expect(services.storage.committed(PATH)!.contents.get('a')).toBe('引言！')
  expect(saveState(wrapper)).toBe('saved')
})

test('新建章节后编辑器切换到新章节', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  await wrapper.find('.chapter-tree__add').trigger('click')
  await wrapper.find('.chapter-tree__rename-input').trigger('keydown', { key: 'Escape' })
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('2未命名章节')
  expect(editorText(wrapper)).toBe('')
})

test('键盘：↓ 切换章节，Enter 进入正文，章节菜单（Shift+F10）上移章节并保存', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  const label = (id: string) => wrapper.find(`.chapter-tree__label[data-chapter-id="${id}"]`)

  await label('a').trigger('keydown', { key: 'ArrowDown' })
  await label('a1').trigger('keydown', { key: 'ArrowDown' })
  await flushPromises()
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('2方法')

  await label('b').trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(editorView(wrapper).hasFocus()).toBe(true)

  await label('b').trigger('keydown', { key: 'F10', shiftKey: true })
  await menuItem(wrapper, '上移').trigger('click')
  await flushPromises()
  expect(rowTexts(wrapper)).toEqual(['1方法', '2绪论', '2.1背景'])
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  expect(services.storage.committed(PATH)!.tree.map((node) => node.id)).toEqual(['b', 'a'])
  expect(services.storage.committed(PATH)!.contents.get('b')).toBe('方法正文')
})

test('菜单栏：格式命令作用于正文选区；只在正文获得焦点时可用', async () => {
  const services = seededServices()
  services.shell.enableAppMenu()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  const view = editorView(wrapper)
  expect(appMenuItem(services, 'editor:bold').disabled).toBe(true)

  view.focus()
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1, 3)))
  await flushPromises()
  expect(appMenuItem(services, 'editor:bold').disabled).toBe(false)
  services.shell.chooseMenuItem('editor:bold')
  await flushPromises()
  expect(view.dom.querySelector('strong')?.textContent).toBe('引言')
  expect(appMenuItem(services, 'editor:bold').checked).toBe(true)

  services.shell.chooseMenuItem('file:save')
  await flushPromises()
  expect(services.storage.committed(PATH)!.contents.get('a')).toBe('**引言**')
})

test('菜单栏：移动章节只在章节树获得焦点时可用，与快捷键结果相同', async () => {
  const services = seededServices()
  services.shell.enableAppMenu()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  await wrapper.findAll('.chapter-tree__row')[2].trigger('click') // 方法
  expect(appMenuItem(services, 'chapter:move-up').disabled).toBe(true)
  ;(wrapper.findAll('.chapter-tree__label')[2].element as HTMLElement).focus()
  await flushPromises()
  expect(appMenuItem(services, 'chapter:move-up').disabled).toBe(false)
  expect(appMenuItem(services, 'chapter:move-down').disabled).toBe(true)
  services.shell.chooseMenuItem('chapter:move-up')
  await flushPromises()
  expect(rowTexts(wrapper)).toEqual(['1方法', '2绪论', '2.1背景'])
  expect(document.activeElement?.textContent).toBe('1方法')
})

test('插入图片：复制进项目并在光标处插入引用', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  services.shell.imagePath = '/Users/我/图片/实验装置.png'
  const wrapper = await mountApp(services)
  await flushPromises()
  const view = editorView(wrapper)
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))

  await wrapper.find('button[aria-label="插入图片"]').trigger('click')
  await flushPromises()

  expect(services.storage.importedAssets).toEqual([
    { path: PATH, sourcePath: '/Users/我/图片/实验装置.png' },
  ])
  // 图片按项目内的文件显示。
  expect(view.dom.querySelector('.editor-image img')?.getAttribute('src')).toBe(
    'file:///文稿/毕业论文/assets/实验装置.png',
  )
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  expect(services.storage.committed(PATH)!.contents.get('a')).toBe('引言\n\n![](../assets/实验装置.png)')
})

test('插入图片：取消选择不做任何事；导入失败显示原因', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()

  await wrapper.find('button[aria-label="插入图片"]').trigger('click')
  await flushPromises()
  expect(services.storage.importedAssets).toEqual([])

  services.shell.imagePath = '/x/a.bmp'
  services.storage.failNext({ code: 'asset-unsupported' })
  await wrapper.find('button[aria-label="插入图片"]').trigger('click')
  await flushPromises()
  expect(wrapper.find('.workspace__error').text()).toContain('PNG、JPG 或 GIF')
  expect(editorText(wrapper)).toBe('引言')
})

test('插入图片期间切换了章节：图片追加到发起请求的章节，不插错位置', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()

  services.shell.pickImageFile = async () => {
    await wrapper.findAll('.chapter-tree__row')[2].trigger('click') // 切到「方法」
    return '/图/a.png'
  }
  await wrapper.find('button[aria-label="插入图片"]').trigger('click')
  await flushPromises()

  expect(editorText(wrapper)).toBe('方法正文')
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  const contents = services.storage.committed(PATH)!.contents
  expect(contents.get('a')).toBe('引言\n\n![](../assets/a.png)\n')
  expect(contents.get('b')).toBe('方法正文')
})

test('没有文档样式与图片布局入口；导出请求只携带内容与结构', async () => {
  const services = createMemoryServices()
  const seeded = createDocument(
    '图文',
    [{ id: 'a', title: '装置', children: [] }],
    new Map([['a', '![装置](../assets/装置.png)\n']]),
  )
  if (!seeded.ok) throw new Error('fixture')
  services.storage.seed(PATH, seeded.document)
  services.shell.enableAppMenu()
  services.shell.lastProjectPath = PATH
  services.shell.exportPath = '/导出/图文.pdf'
  const wrapper = await mountApp(services)
  await flushPromises()

  expect(wrapper.find('button[aria-label="文档样式"]').exists()).toBe(false)
  const items = services.shell.appMenus!.flatMap((menu) => menu.items)
  expect(items.some((item) => 'id' in item && item.id.startsWith('format:'))).toBe(false)

  // 选中图片：没有尺寸 / 对齐按钮，不产生修改。
  const view = editorView(wrapper)
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, 0)))
  await flushPromises()
  expect(wrapper.find('[aria-label="图片布局"]').exists()).toBe(false)
  expect(saveState(wrapper)).not.toBe('dirty')

  await exportPdf(wrapper)
  const { request } = services.output.exports[0]
  expect(Object.keys(request).sort()).toEqual(['author', 'chapters', 'references', 'subtitle', 'title'])
  expect(request.chapters[0].markdown).toBe('![装置](../assets/装置.png)\n')
})

test('导出 Word：选择位置后导出当前文档（含未保存修改），完成后提示', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  services.shell.exportPath = '/导出/毕业论文.docx'
  const wrapper = await mountApp(services)
  await flushPromises()
  typeAtEnd(editorView(wrapper), '（未保存）')

  await button(wrapper, '导出').trigger('click')
  await button(wrapper, '导出为 Word（.docx）…').trigger('click')
  await flushPromises()

  expect(services.output.exports).toHaveLength(1)
  const exported = services.output.exports[0]
  expect(exported.format).toBe('docx')
  expect(exported.targetPath).toBe('/导出/毕业论文.docx')
  expect(exported.request.chapters[0].markdown).toBe('引言（未保存）')
  expect(wrapper.find('.workspace__notice').text()).toContain('已导出 毕业论文.docx')

  await button(wrapper, '在文件夹中显示').trigger('click')
  expect(services.shell.revealed).toEqual(['/导出/毕业论文.docx'])
})

test('导出：取消选择位置不导出；失败时显示原因；图片缺失时提示', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()

  await exportPdf(wrapper)
  expect(services.output.exports).toHaveLength(0)

  services.shell.exportPath = '/导出/a.pdf'
  services.output.failNext({ code: 'no-cjk-font' })
  await exportPdf(wrapper)
  expect(wrapper.find('.workspace__error').text()).toContain('中文的字体')

  services.output.missingImages = ['../assets/丢失.png']
  await exportPdf(wrapper)
  expect(wrapper.find('.workspace__notice').text()).toContain('1 张图片无法嵌入')

  services.output.brokenReferences = ['原目标', '另一处']
  await exportPdf(wrapper)
  expect(wrapper.find('.workspace__notice').text()).toContain(
    '其中 1 张图片无法嵌入，已用文字占位；2 处章节引用已失效，已按原来的文字输出。',
  )
})

test('侧栏宽度：分隔线可用方向键调整，限制在 180–480px', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  const resizer = wrapper.find('.workspace__resizer')
  const width = () => Number(resizer.attributes('aria-valuenow'))
  const start = width()
  await resizer.trigger('keydown', { key: 'ArrowRight' })
  expect(width()).toBe(start + 16)
  await resizer.trigger('keydown', { key: 'Home' })
  expect(width()).toBe(180)
  await resizer.trigger('keydown', { key: 'ArrowLeft' })
  expect(width()).toBe(180)
  await resizer.trigger('dblclick')
  expect(width()).toBe(260)
})

test('菜单栏反映编辑器状态：在代码块中粗体不可用，代码块打勾', async () => {
  const services = createMemoryServices()
  services.shell.enableAppMenu()
  const doc = createDocument('代码', [{ id: 'a', title: '代码', children: [] }], new Map([['a', '```\ncode\n```\n']]))
  if (!doc.ok) throw new Error('fixture')
  services.storage.seed(PATH, doc.document)
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  const view = wrapper.findComponent(ChapterEditor).vm.getView() as EditorView
  view.focus()
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 2)))
  await flushPromises()
  expect(appMenuItem(services, 'editor:bold').disabled).toBe(true)
  expect(appMenuItem(services, 'editor:code-block').checked).toBe(true)
})

test('菜单栏的列表选择入口打开编辑区菜单，任务列表写入项目正文', async () => {
  const services = seededServices()
  services.shell.enableAppMenu()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  const view = editorView(wrapper)
  view.coordsAtPos = () => ({ left: 10, right: 10, top: 0, bottom: 20 })
  view.focus()
  await flushPromises()
  expect(appMenuItem(services, 'edit:list-menu').disabled).toBe(false)
  services.shell.chooseMenuItem('edit:list-menu')
  await flushPromises()
  const tasks = wrapper.findAll('[role="menu"] button').find((item) => item.text().includes('任务列表'))!
  await tasks.trigger('click')
  await flushPromises()
  expect(view.state.doc.firstChild?.firstChild?.attrs.checked).toBe(false)
  expect(appMenuItem(services, 'editor:task-list').checked).toBe(true)
  expect(view.hasFocus()).toBe(true)
})

test('隐藏侧栏：焦点在侧栏中时交给正文；快捷键与菜单栏切换同一个状态，并记住偏好', async () => {
  const services = seededServices()
  services.shell.enableAppMenu()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  ;(wrapper.find('.chapter-tree__label').element as HTMLElement).focus()

  services.shell.chooseMenuItem('view:sidebar')
  await flushPromises()
  expect(wrapper.find('.workspace__sidebar').isVisible()).toBe(false)
  expect(editorView(wrapper).hasFocus()).toBe(true)
  expect(appMenuItem(services, 'view:sidebar').label).toBe('显示侧栏')
  expect(services.shell.getPreference('sidebar-visible')).toBe('false')

  await button(wrapper, '显示侧栏').trigger('click')
  expect(wrapper.find('.workspace__sidebar').isVisible()).toBe(true)
})

test('⌘Y 显示 / 隐藏侧栏', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', ...MOD }))
  await flushPromises()
  expect(wrapper.find('.workspace__sidebar').isVisible()).toBe(false)

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', ...MOD }))
  await flushPromises()
  expect(wrapper.find('.workspace__sidebar').isVisible()).toBe(true)

  // 正文中同样有效：ProseMirror 默认会拦下 Mod-y（防止浏览器原生重做）。
  const view = editorView(wrapper)
  view.focus()
  view.dom.dispatchEvent(new KeyboardEvent('keydown', { key: 'y', code: 'KeyY', keyCode: 89, bubbles: true, cancelable: true, ...MOD }))
  await flushPromises()
  expect(wrapper.find('.workspace__sidebar').isVisible()).toBe(false)
  expect(view.hasFocus()).toBe(true)
})

test('把侧栏分隔线拖到最窄处以外松手：隐藏侧栏', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  const resizer = wrapper.find('.workspace__resizer')
  await resizer.trigger('pointerdown', { button: 0, clientX: 260, pointerId: 1 })
  resizer.element.dispatchEvent(new PointerEvent('pointermove', { clientX: 100, pointerId: 1 }))
  resizer.element.dispatchEvent(new PointerEvent('pointerup', { clientX: 100, pointerId: 1 }))
  await flushPromises()
  expect(wrapper.find('.workspace__sidebar').isVisible()).toBe(false)
})

test('保存失败的原因可以关闭；工具栏中的"保存失败"保留到保存成功', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await wrapper.find('.chapter-tree__add').trigger('click')
  services.storage.failNext({ code: 'io', operation: 'write', path: 'x', message: '磁盘已满' })
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  await wrapper.find('.workspace__save-error [aria-label="关闭提示"]').trigger('click')
  expect(wrapper.find('.workspace__save-error').exists()).toBe(false)
  expect(wrapper.find('.save-status').text()).toContain('保存失败')
})

test('⌘J 在正文与章节树之间切换：进入树时焦点在当前章节；侧栏隐藏时先显示', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  services.shell.enableAppMenu()
  const wrapper = await mountApp(services)
  await flushPromises()
  const label = (id: string) => wrapper.find(`.chapter-tree__label[data-chapter-id="${id}"]`)
  await label('a').trigger('keydown', { key: 'End' })
  await flushPromises()

  pressInEditor(wrapper, { key: 'j', code: 'KeyJ', ...MOD })
  await flushPromises()
  expect(focusedChapter()).toBe('b')
  expect(appMenuItem(services, 'view:switch-focus').label).toBe('转到正文')

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', ...MOD }))
  await flushPromises()
  expect(editorView(wrapper).hasFocus()).toBe(true)
  expect(appMenuItem(services, 'view:switch-focus').label).toBe('转到章节树')

  services.shell.chooseMenuItem('view:sidebar')
  await flushPromises()
  expect(wrapper.find('.workspace__sidebar').isVisible()).toBe(false)
  services.shell.chooseMenuItem('view:switch-focus')
  await flushPromises()
  expect(wrapper.find('.workspace__sidebar').isVisible()).toBe(true)
  expect(focusedChapter()).toBe('b')
})

test('章节树中 ⌘N 新建章节、⌘↩ 重命名；正文中 ⌘N、⌘↩ 不作用于章节', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  const label = (id: string) => wrapper.find(`.chapter-tree__label[data-chapter-id="${id}"]`)

  pressInEditor(wrapper, { key: 'Enter', code: 'Enter', ...MOD })
  await flushPromises()
  expect(wrapper.find('.chapter-tree__rename-input').exists()).toBe(false)
  pressInEditor(wrapper, { key: 'n', code: 'KeyN', ...MOD })
  await flushPromises()
  expect(rowTexts(wrapper)).toEqual(['1绪论', '1.1背景', '2方法'])

  await label('a').trigger('keydown', { key: 'n', code: 'KeyN', ...MOD })
  await flushPromises()
  const input = wrapper.find<HTMLInputElement>('.chapter-tree__rename-input')
  await input.setValue('结论')
  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(rowTexts(wrapper)).toEqual(['1绪论', '1.1背景', '2结论', '3方法'])
  expect(focusedChapter()).toBe(wrapper.find('.chapter-tree__row--selected .chapter-tree__label').attributes('data-chapter-id'))
  expect(editorView(wrapper).hasFocus()).toBe(false)

  await label('b').trigger('keydown', { key: 'Enter', code: 'Enter', ...MOD })
  await flushPromises()
  expect(wrapper.find<HTMLInputElement>('.chapter-tree__rename-input').element.value).toBe('方法')
})

test('全文阅读：工具栏按钮打开，连续显示所有章节；编辑器保留在下面不可操作；Esc 回到编辑，撤销历史仍在', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  services.shell.enableAppMenu()
  const wrapper = await mountApp(services)
  await flushPromises()
  typeAtEnd(editorView(wrapper), '！')

  await button(wrapper, '全文阅读').trigger('click')
  await flushPromises()
  const reader = wrapper.find('.document-reader')
  expect(reader.findAll('.document-reader__heading').map((heading) => heading.text())).toEqual([
    '1绪论',
    '1.1背景',
    '2方法',
  ])
  expect(reader.text()).toContain('引言！')
  expect(document.activeElement).toBe(reader.element)
  expect(wrapper.find('.chapter-editor').attributes('inert')).toBeDefined()
  expect(wrapper.find('[aria-label="插入表格"]').exists()).toBe(false)
  expect(button(wrapper, '全文阅读').attributes('aria-pressed')).toBe('true')
  expect(appMenuItem(services, 'view:reader').checked).toBe(true)

  await reader.trigger('keydown', { key: 'Escape' })
  await flushPromises()
  expect(wrapper.find('.document-reader').exists()).toBe(false)
  expect(wrapper.find('.chapter-editor').attributes('inert')).toBeUndefined()
  expect(editorView(wrapper).hasFocus()).toBe(true)
  expect(appMenuItem(services, 'view:reader').checked).toBe(false)
  // 测试环境没有排版，阅读位置可能落在别的章节；回到绪论检查它的撤销历史。
  await wrapper.findAll('.chapter-tree__row')[0].trigger('click')
  expect(editorText(wrapper)).toBe('引言！')
  expect(undoDepth(editorView(wrapper).state)).toBe(1)
})

test('全文阅读：⇧⌘R 打开与关闭；阅读中滚动到的章节在章节树中选中，回到编辑时编辑该章节', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  // 与真实按键一样可取消：App 屏蔽刷新页面时会先取消 ⌘R 类按键的默认行为，快捷键仍要响应。
  const shortcut = () =>
    window.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'R', code: 'KeyR', shiftKey: true, cancelable: true, ...MOD }),
    )

  shortcut()
  await flushPromises()
  wrapper.findComponent(DocumentReader).vm.$emit('select', 'b')
  await flushPromises()
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('2方法')

  shortcut()
  await flushPromises()
  expect(wrapper.find('.document-reader').exists()).toBe(false)
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('2方法')
  expect(editorView(wrapper).hasFocus()).toBe(true)
})

test('全文阅读：章节树中点选章节后按 Enter，回到编辑该章节；⌘J 在章节树与阅读区之间切换', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  const label = (id: string) => wrapper.find(`.chapter-tree__label[data-chapter-id="${id}"]`)

  await button(wrapper, '全文阅读').trigger('click')
  await flushPromises()
  await label('a').trigger('keydown', { key: 'End' })
  await flushPromises()
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('2方法')

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', ...MOD }))
  await flushPromises()
  expect(document.activeElement).toBe(wrapper.find('.document-reader').element)
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', code: 'KeyJ', ...MOD }))
  await flushPromises()
  expect(focusedChapter()).toBe('b')

  await label('b').trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(wrapper.find('.document-reader').exists()).toBe(false)
  expect(wrapper.find('.chapter-editor__heading').text()).toBe('2方法')
  expect(editorView(wrapper).hasFocus()).toBe(true)
})

test('全文阅读：删除所有章节后回到空文档的提示', async () => {
  const services = createMemoryServices()
  const document = createDocument('短文', [{ id: 'x', title: '唯一', children: [] }], new Map([['x', '']]))
  if (!document.ok) throw new Error('fixture')
  services.storage.seed(PATH, document.document)
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()

  await button(wrapper, '全文阅读').trigger('click')
  await flushPromises()
  await wrapper.find('.chapter-tree__row .chapter-tree__more').trigger('click')
  await button(wrapper, '删除').trigger('click')
  await flushPromises()
  expect(wrapper.find('.document-reader').exists()).toBe(false)
  expect(wrapper.find('.workspace__placeholder').text()).toContain('还没有章节')
  expect(button(wrapper, '全文阅读').attributes('disabled')).toBeDefined()
})

test('章节引用：⌘K 选择目标并插入；⌘ + 单击前往，提示中与菜单栏中返回', async () => {
  const services = seededServices()
  services.shell.enableAppMenu()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  const view = editorView(wrapper)
  view.focus()
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))

  services.shell.chooseMenuItem('editor:chapter-ref')
  await flushPromises()
  const input = wrapper.find('.chapter-ref-picker input')
  await input.setValue('方法')
  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  expect(wrapper.find('.chapter-ref-picker').exists()).toBe(false)
  expect(view.dom.querySelector('.chapter-ref')?.textContent).toBe('2 方法')

  // ⌘ + 单击：前往“方法”，光标在开头；提示中可以返回。
  view.dom.querySelector('.chapter-ref')!.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...MOD }),
  )
  await flushPromises()
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('2方法')
  expect(editorView(wrapper).state.selection.from).toBe(1)
  expect(wrapper.find('.workspace__jump').text()).toContain('已前往“2 方法”')
  expect(appMenuItem(services, 'view:back').disabled).toBe(false)

  await wrapper.find('.workspace__jump button').trigger('click')
  await flushPromises()
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('1绪论')
  expect(wrapper.find('.workspace__jump').exists()).toBe(false)
  expect(appMenuItem(services, 'view:back').disabled).toBe(true)

  // 再次前往后用菜单栏返回。
  editorView(wrapper).dom.querySelector('.chapter-ref')!.dispatchEvent(
    new MouseEvent('mousedown', { bubbles: true, cancelable: true, button: 0, ...MOD }),
  )
  await flushPromises()
  services.shell.chooseMenuItem('view:back')
  await flushPromises()
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('1绪论')

  // 返回后可以再前进。
  expect(appMenuItem(services, 'view:forward').disabled).toBe(false)
  services.shell.chooseMenuItem('view:forward')
  await flushPromises()
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('2方法')
  expect(appMenuItem(services, 'view:forward').disabled).toBe(true)
  expect(appMenuItem(services, 'view:back').disabled).toBe(false)

  // 正文中按 ⌘[ / ⌘]：编辑器不再把它们当作列表缩进，由工作区返回 / 前进。
  const press = (key: string, code: string) =>
    editorView(wrapper).dom.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true, ...MOD }))
  press('[', 'BracketLeft')
  await flushPromises()
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('1绪论')
  press(']', 'BracketRight')
  await flushPromises()
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('2方法')

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  expect(services.storage.committed(PATH)!.contents.get('a')).toBe('引言[2 方法](writer:chapter/b)')
})

test('章节引用：取消选择不改变正文，焦点回到正文', async () => {
  const services = seededServices()
  services.shell.enableAppMenu()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  const view = editorView(wrapper)
  view.focus()
  const before = editorText(wrapper)
  services.shell.chooseMenuItem('editor:chapter-ref')
  await flushPromises()
  await wrapper.find('.chapter-ref-picker input').trigger('keydown', { key: 'Escape' })
  await flushPromises()
  expect(wrapper.find('.chapter-ref-picker').exists()).toBe(false)
  expect(editorText(wrapper)).toBe(before)
  expect(saveState(wrapper)).toBe('saved')
  expect(document.activeElement).toBe(view.dom)
})

test('更新交叉引用：改名后写回链接文字过期的章节（编辑器撤销历史不变），列出失效引用并可跳过去', async () => {
  const services = createMemoryServices()
  services.shell.enableAppMenu()
  const document = createDocument(
    '论文',
    tree,
    new Map([
      ['a', '见[2 方法](writer:chapter/b)\n'],
      ['a1', '* 列表\n\n见[旧](writer:chapter/b?show=title)与[已删](writer:chapter/gone)\n'],
      ['b', '方法正文\n'],
    ]),
  )
  if (!document.ok) throw new Error('fixture')
  services.storage.seed(PATH, document.document)
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  const view = editorView(wrapper)
  typeAtEnd(view, '！')
  await flushPromises()
  const history = undoDepth(view.state)

  // 改名：编辑器中立即更新，正文不变。
  expect(editorView(wrapper).dom.querySelector('.chapter-ref')?.textContent).toBe('2 方法')
  await wrapper.findAll('.chapter-tree__row')[2]!.trigger('click') // 方法
  await flushPromises()
  services.shell.chooseMenuItem('chapter:rename')
  await flushPromises()
  await wrapper.find('.chapter-tree__rename-input').setValue('研究方法')
  await wrapper.find('.chapter-tree__rename-input').trigger('keydown', { key: 'Enter' })
  await wrapper.findAll('.chapter-tree__row')[0]!.trigger('click') // 绪论
  await flushPromises()
  expect(editorView(wrapper).dom.querySelector('.chapter-ref')?.textContent).toBe('2 研究方法')

  services.shell.chooseMenuItem('insert:update-chapter-refs')
  await flushPromises()
  const report = wrapper.find('.ref-report')
  expect(report.text()).toContain('已更新 2 个章节中的 2 处引用文字。')
  expect(report.text()).toContain('1 处引用已失效')
  expect(report.text()).toContain('1.1 背景')
  // 打开过的章节：编辑器状态与撤销历史不变。
  expect(undoDepth(editorView(wrapper).state)).toBe(history)

  await report.find('.ref-report__item').trigger('click')
  await flushPromises()
  expect(wrapper.find('.ref-report').exists()).toBe(false)
  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('1.1背景')
  const selection = editorView(wrapper).state.selection as NodeSelection
  expect(selection.node.attrs.cached).toBe('已删')

  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  const saved = services.storage.committed(PATH)!.contents
  expect(saved.get('a')).toBe('见[2 研究方法](writer:chapter/b)！\n')
  expect(saved.get('a1')).toBe('- 列表\n\n见[研究方法](writer:chapter/b?show=title)与[已删](writer:chapter/gone)\n')
  expect(saved.get('b')).toBe('方法正文\n')
})
