import { afterEach, expect, test } from 'vitest'
import { flushPromises } from '@vue/test-utils'
import { Selection, TextSelection } from 'prosemirror-state'
import { Fragment, Slice } from 'prosemirror-model'
import type { EditorView } from 'prosemirror-view'
import { schema } from '../editor/schema.ts'
import { PATH, MOD, seededServices, mountApp, unmountAll, editorView } from '../../testing/app_harness.ts'

/** 粘贴 / 拖入图片：导入项目资源后插入正文。 */

afterEach(unmountAll)

function transfer(files: File[]): DataTransfer {
  return { files, types: ['Files'], getData: () => '' } as unknown as DataTransfer
}

function paste(view: EditorView, files: File[], slice = Slice.empty): boolean {
  const event = { clipboardData: transfer(files), preventDefault() {} } as unknown as ClipboardEvent
  return view.someProp('handlePaste', (handle) => handle(view, event, slice)) ?? false
}

const png = () => new File([new Uint8Array([0x89, 0x50, 0x4e, 0x47])], '截屏.png', { type: 'image/png' })

async function save(services: ReturnType<typeof seededServices>): Promise<string | undefined> {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  return services.storage.committed(PATH)!.contents.get('a')
}

test('粘贴图片：导入项目资源，在光标处插入', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  const view = editorView(wrapper)
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))

  expect(paste(view, [png()])).toBe(true)
  await flushPromises()
  expect(services.storage.importedData.map(({ fileName, data }) => [fileName, data.length])).toEqual([['截屏.png', 4]])
  expect(await save(services)).toBe('引言\n\n![](../assets/截屏.png)')
})

test('同时有文字时按文字粘贴，不导入图片；不是图片的文件不处理', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  const view = editorView(wrapper)
  const text = new Slice(Fragment.from(schema.nodes.paragraph.create(null, schema.text('图文'))), 1, 1)

  expect(paste(view, [png()], text)).toBe(false)
  expect(paste(view, [new File(['x'], 'a.txt', { type: 'text/plain' })])).toBe(false)
  expect(services.storage.importedData).toEqual([])
})

test('拖入图片：插入到放下的位置；导入失败显示原因', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  const view = editorView(wrapper)
  view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, 1)))
  view.posAtCoords = () => ({ pos: 3, inside: -1 })

  const drop = { dataTransfer: transfer([png()]), clientX: 0, clientY: 0, preventDefault() {} } as unknown as DragEvent
  expect(view.someProp('handleDrop', (handle) => handle(view, drop, Slice.empty, false))).toBe(true)
  await flushPromises()
  expect(await save(services)).toBe('引言\n\n![](../assets/截屏.png)')

  services.storage.failures.push({ code: 'asset-too-large' })
  view.someProp('handleDrop', (handle) => handle(view, drop, Slice.empty, false))
  await flushPromises()
  expect(wrapper.find('.workspace__error').exists()).toBe(true)
})

test('WebView 不能解码的格式说明不支持', async () => {
  const services = seededServices()
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  paste(editorView(wrapper), [new File(['x'], '照片.heic', { type: 'image/heic' })])
  await flushPromises()
  expect(wrapper.find('.workspace__error').text()).toContain('不支持这种图片格式')
})
