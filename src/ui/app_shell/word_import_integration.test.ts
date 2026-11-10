import { afterEach, expect, test, vi } from 'vitest'
import { flushPromises, mount } from '@vue/test-utils'
import App from '../../App.vue'
import { createProject } from '../../application/project_lifecycle.ts'
import { createMemoryServices } from '../../testing/memory_services.ts'
import { APP_SERVICES } from '../services.ts'
import { WORD_IMPORT } from './word_import_port.ts'
import WordImportDialog from './WordImportDialog.vue'
import UpdateDialog from './UpdateDialog.vue'
import { emptyDocument } from '../../domain/document/document.ts'

const wrappers: ReturnType<typeof mount>[] = []
afterEach(() => { for (const wrapper of wrappers.splice(0)) wrapper.unmount() })

test('欢迎页导入：选择文件和目录，创建并进入新项目', async () => {
  const services = createMemoryServices()
  const importProject = vi.fn(() => createProject(services.storage, '/测试/报告', '报告'))
  const wrapper = mount(App, { global: { provide: {
    [APP_SERVICES as symbol]: services,
    [WORD_IMPORT as symbol]: { pickFile: async () => '/测试/报告.docx', pickDirectory: async () => '/测试', importProject },
  } } })
  wrappers.push(wrapper)
  await flushPromises()
  await wrapper.findAll('button').find(b => b.text() === '从 Word 导入…')!.trigger('click')
  await wrapper.find('[aria-labelledby="word-import-file-label word-import-file-button"]').trigger('click')
  await flushPromises()
  expect((wrapper.find('#word-import-name').element as HTMLInputElement).value).toBe('报告')
  await wrapper.find('[aria-labelledby="word-import-directory-label word-import-directory-button"]').trigger('click')
  await flushPromises()
  await wrapper.find('form.word-import').trigger('submit')
  await flushPromises()
  expect(importProject).toHaveBeenCalledWith({ filePath: '/测试/报告.docx', projectName: '报告', targetDirectory: '/测试' })
  expect(wrapper.find('.workspace').exists()).toBe(true)
  expect(services.shell.lastProjectPath).toBe('/测试/报告')
})

test('导入成功后完整展示所有警告并可确认关闭', async () => {
  const services = createMemoryServices()
  const warnings = ['table_unsupported', 'table_header_assumed', 'table_header_rows_degraded', 'table_cell_structure_degraded', 'image_external_or_missing', 'image_path_unsupported', 'image_unreadable', 'image_format_unsupported', 'heading_image_unsupported', 'body_content_unsupported', 'list_numbering_unsupported', 'hyperlink_target_unsupported', 'drawing_unsupported', 'note_unsupported', 'field_unsupported', 'math_unsupported', 'future_warning: detail']
  const importProject = async () => {
    const result = await createProject(services.storage, '/测试/报告', '报告')
    return result.ok ? { ...result, warnings } : result
  }
  const wrapper = mount(App, { global: { provide: {
    [APP_SERVICES as symbol]: services,
    [WORD_IMPORT as symbol]: { pickFile: async () => '/测试/报告.docx', pickDirectory: async () => '/测试', importProject },
  } } })
  wrappers.push(wrapper)
  await flushPromises()
  await wrapper.findAll('button').find(b => b.text() === '从 Word 导入…')!.trigger('click')
  await wrapper.find('[aria-labelledby="word-import-file-label word-import-file-button"]').trigger('click')
  await flushPromises()
  await wrapper.find('[aria-labelledby="word-import-directory-label word-import-directory-button"]').trigger('click')
  await flushPromises()
  await wrapper.find('form.word-import').trigger('submit')
  await flushPromises()
  expect(wrapper.find('.workspace').exists()).toBe(true)
  expect(wrapper.find('#warning-description').text()).toBe('请对照原文检查以下内容。')
  expect(wrapper.find('.warning').attributes('aria-describedby')).toBe('warning-description warning-list')
  expect(wrapper.findAll('.warning__list li').map(item => item.text())).toEqual([
    '部分表格结构不受支持，已将单元格内容作为普通段落导入。', '部分表格没有明确的 Word 表头，已将第一行作为表头。',
    '部分表格的多行 Word 表头仅保留第一行为表头，其余表头行已作为正文。', '部分表格单元格中的段落或换行已转换为空格。', '部分图片为外部图片或缺失，未导入。', '部分图片路径不受支持，未导入。',
    '部分图片无法读取，未导入。', '部分图片格式不受支持，未导入。', '标题中的图片未导入。',
    '文档中的部分内容不受支持，未导入。', '部分列表编号未能保留，包括标题自动编号或通过段落样式继承的列表编号。', '部分超链接目标未能保留。',
    '文档中的部分绘图未导入。', '文档中的脚注或尾注未导入。', '部分域不受支持或不完整；可读取的结果已作为普通内容导入，域功能未保留。',
    '文档中的公式未导入。', '未识别的导入警告：future_warning: detail',
  ])
  await wrapper.find('.warning__button').trigger('click')
  expect(wrapper.find('.warning').exists()).toBe(false)
})

test('结构化警告逐处显示位置并保留没有详情的旧警告', async () => {
  const services = createMemoryServices()
  const importProject = async () => {
    const result = await createProject(services.storage, '/测试/报告', '报告')
    return result.ok ? { ...result, warnings: ['image_unreadable', 'future'], warningDetails: [
      { code: 'image_unreadable', location: { block: 2, row: 3, cell: 1, tableIndex: 2 }, contentType: 'image', nearbyText: '图表说明' },
      { code: 'image_unreadable', location: { block: 4 }, contentType: 'image' },
    ] } : result
  }
  const wrapper = mount(App, { global: { provide: { [APP_SERVICES as symbol]: services, [WORD_IMPORT as symbol]: { pickFile: async () => '/测试/报告.docx', pickDirectory: async () => '/测试', importProject } } } })
  wrappers.push(wrapper)
  await flushPromises()
  await wrapper.findAll('button').find(b => b.text() === '从 Word 导入…')!.trigger('click')
  await wrapper.find('[aria-labelledby="word-import-file-label word-import-file-button"]').trigger('click')
  await flushPromises()
  await wrapper.find('[aria-labelledby="word-import-directory-label word-import-directory-button"]').trigger('click')
  await flushPromises()
  await wrapper.find('form.word-import').trigger('submit')
  await flushPromises()
  expect(wrapper.findAll('.warning__list li').map(item => item.text())).toEqual([
    '第 2 个正文块，第 2 个表格，第 3 行，第 1 个单元格（image）：部分图片无法读取，未导入。 附近文字：图表说明',
    '第 4 个正文块（image）：部分图片无法读取，未导入。',
    '未识别的导入警告：future',
  ])
})

test('导入进行时阻止关闭和更新重启，完成后恢复关闭', async () => {
  const services = createMemoryServices()
  services.shell.enableAppMenu()
  services.shell.updateResult = { kind: 'available', current: '1', version: '2', notes: null }
  let finish!: () => void
  const pending = new Promise<void>(resolve => { finish = resolve })
  const wrapper = mount(App, { global: { provide: {
    [APP_SERVICES as symbol]: services,
    [WORD_IMPORT as symbol]: { pickFile: async () => null, pickDirectory: async () => null, importProject: async () => { await pending; return createProject(services.storage, '/新项目', '新项目') } },
  } } })
  wrappers.push(wrapper)
  await flushPromises()
  services.shell.chooseMenuItem('app:check-update')
  await flushPromises()
  // 使用对话框事件触发安装与重启，覆盖更新用例的实际回调。
  if (!wrapper.findComponent(UpdateDialog).exists()) {
    services.shell.chooseMenuItem('help:check-update')
    await flushPromises()
  }
  expect(wrapper.findComponent(UpdateDialog).exists()).toBe(true)
  wrapper.findComponent(UpdateDialog).vm.$emit('install')
  await flushPromises()
  wrapper.findComponent(UpdateDialog).vm.$emit('close')
  await flushPromises()
  await wrapper.findAll('button').find(b => b.text() === '从 Word 导入…')!.trigger('click')
  wrapper.findComponent(WordImportDialog).vm.$emit('submit', { filePath: '/a.docx', projectName: '新项目', targetDirectory: '/' })
  await flushPromises()
  expect(await services.shell.requestClose()).toBe(false)
  services.shell.chooseMenuItem('app:check-update')
  await flushPromises()
  wrapper.findComponent(UpdateDialog).vm.$emit('restart')
  await flushPromises()
  expect(services.shell.restarts).toBe(0)
  finish()
  await flushPromises()
  expect(await services.shell.requestClose()).toBe(true)
  expect(services.storage.closed).toContain('/新项目')
})

test('导入和原项目恢复均失败时，在导入对话框中同时说明', async () => {
  const services = createMemoryServices()
  services.storage.seed('/原项目', emptyDocument('原项目'))
  services.shell.lastProjectPath = '/原项目'
  const wrapper = mount(App, { global: { provide: {
    [APP_SERVICES as symbol]: services,
    [WORD_IMPORT as symbol]: { pickFile: async () => null, pickDirectory: async () => null, importProject: async () => {
      services.storage.failNext({ code: 'not-a-project' })
      return { ok: false, error: { code: 'target-not-empty' } }
    } },
  } } })
  wrappers.push(wrapper)
  await flushPromises()
  wrapper.findComponent({ name: 'Workspace' }).vm.$emit('import-word')
  await flushPromises()
  wrapper.findComponent(WordImportDialog).vm.$emit('submit', { filePath: '/a.docx', projectName: '新项目', targetDirectory: '/' })
  await flushPromises()
  expect(wrapper.find('.word-import__error').text()).toContain('原项目未能重新打开（/原项目）')
  expect(wrapper.find('.word-import__error').text()).toContain('不为空')
})

test.each(['result', 'throw'])('导入失败（%s）提示检查可能残留的项目', async mode => {
  const services = createMemoryServices()
  const wrapper = mount(App, { global: { provide: {
    [APP_SERVICES as symbol]: services,
    [WORD_IMPORT as symbol]: { pickFile: async () => null, pickDirectory: async () => null, importProject: async () => {
      if (mode === 'throw') throw new Error('failed')
      return { ok: false, error: { code: 'target-not-empty' } }
    } },
  } } })
  wrappers.push(wrapper)
  await flushPromises()
  await wrapper.findAll('button').find(b => b.text() === '从 Word 导入…')!.trigger('click')
  wrapper.findComponent(WordImportDialog).vm.$emit('submit', { filePath: '/a.docx', projectName: '项目', targetDirectory: '/' })
  await flushPromises()
  expect(wrapper.find('.word-import__error').text()).toContain('目标目录中可能残留不完整的项目，请检查后再重试')
})

test.each(['welcome', 'workspace'])('导入对话框打开时拦截%s的项目切换菜单，关闭后恢复', async location => {
  const services = createMemoryServices()
  services.shell.enableAppMenu()
  services.storage.seed('/其他项目', emptyDocument('其他项目'))
  services.shell.preferences.set('recentProjects', JSON.stringify(['/其他项目']))
  if (location === 'workspace') {
    services.storage.seed('/原项目', emptyDocument('原项目'))
    services.shell.lastProjectPath = '/原项目'
  }
  const pickNew = vi.spyOn(services.shell, 'pickNewProjectPath')
  const pickOpen = vi.spyOn(services.shell, 'pickProjectPath')
  const wrapper = mount(App, { global: { provide: { [APP_SERVICES as symbol]: services } } })
  wrappers.push(wrapper)
  await flushPromises()
  services.shell.chooseMenuItem('file:import-word')
  await flushPromises()
  expect(wrapper.findComponent(WordImportDialog).exists()).toBe(true)
  services.shell.chooseMenuItem('file:new')
  services.shell.chooseMenuItem('file:open')
  services.shell.chooseMenuItem(location === 'workspace' ? 'file:recent-1' : 'file:recent-0')
  services.shell.chooseMenuItem('file:recent-clear')
  await flushPromises()
  expect(services.shell.preferences.get('recentProjects')).toContain('/其他项目')
  expect(services.shell.lastProjectPath).not.toBe('/其他项目')
  expect(pickNew).not.toHaveBeenCalled()
  expect(pickOpen).not.toHaveBeenCalled()
  expect(services.storage.closed).not.toContain('/原项目')
  wrapper.findComponent(WordImportDialog).vm.$emit('cancel')
  await flushPromises()
  services.shell.chooseMenuItem('file:new')
  await flushPromises()
  expect(pickNew).toHaveBeenCalledOnce()
})

test('未提供导入能力时明确说明，取消不改变当前页面', async () => {
  const services = createMemoryServices()
  const wrapper = mount(App, { global: { provide: { [APP_SERVICES as symbol]: services } } })
  wrappers.push(wrapper)
  await flushPromises()
  await wrapper.findAll('button').find(b => b.text() === '从 Word 导入…')!.trigger('click')
  expect(wrapper.find('[role="alert"]').text()).toContain('暂不支持')
  await wrapper.findAll('button').find(b => b.text() === '取消')!.trigger('click')
  expect(wrapper.find('.welcome').exists()).toBe(true)
})
