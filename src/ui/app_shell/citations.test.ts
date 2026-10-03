import { afterEach, expect, test } from 'vitest'
import { flushPromises, type VueWrapper } from '@vue/test-utils'
import { Selection } from 'prosemirror-state'
import { createMemoryServices } from '../../testing/memory_services.ts'
import { createDocument, setReferences } from '../../domain/document/document.ts'
import { emptyReference } from '../../domain/bibliography/bibliography.ts'
import { PATH, MOD, mountApp, unmountAll, editorView, button } from '../../testing/app_harness.ts'

/** 参考文献与文献引用（docs/decisions.md 第 13 节）。 */

afterEach(unmountAll)

const book = { ...emptyReference('b1', 'book'), author: '张三', title: '长文档写作', place: '北京', publisher: '某出版社', year: '2020' }
const article = { ...emptyReference('a1', 'article'), author: '李四', title: '结构化写作', container: '编辑学报', year: '2021' }

async function openDocument(references = [book, article]) {
  const services = createMemoryServices()
  services.shell.enableAppMenu()
  const document = createDocument(
    '论文',
    [
      { id: 'a', title: '绪论', children: [] },
      { id: 'b', title: '方法', children: [] },
    ],
    new Map([
      ['a', '研究现状。'],
      ['b', '已有研究[[1]](writer:cite/a1)。'],
    ]),
  )
  if (!document.ok) throw new Error('fixture')
  services.storage.seed(PATH, setReferences(document.document, references))
  services.shell.lastProjectPath = PATH
  const wrapper = await mountApp(services)
  await flushPromises()
  return { services, wrapper }
}

async function save(services: ReturnType<typeof createMemoryServices>) {
  window.dispatchEvent(new KeyboardEvent('keydown', { key: 's', ...MOD }))
  await flushPromises()
  return services.storage.committed(PATH)!
}

function placeCaretAtEnd(wrapper: VueWrapper) {
  const view = editorView(wrapper)
  view.focus()
  view.dispatch(view.state.tr.setSelection(Selection.atEnd(view.state.doc)))
}

test('插入文献引用：按首次引用的顺序编号，显示为上标；后面章节中的编号随之后移', async () => {
  const { services, wrapper } = await openDocument()
  placeCaretAtEnd(wrapper)
  services.shell.chooseMenuItem('editor:citation')
  await flushPromises()
  const options = wrapper.findAll('.citation-picker [role="option"]').map((option) => option.text())
  expect(options).toEqual(['张三. 长文档写作[M]. 北京: 某出版社, 2020.', '[1]李四. 结构化写作[J]. 编辑学报, 2021.'])

  const input = wrapper.find('.citation-picker input')
  await input.setValue('张三')
  await input.trigger('keydown', { key: 'Enter' })
  await flushPromises()
  const ref = editorView(wrapper).dom.querySelector('.chapter-ref.is-citation')!
  // 绪论在方法之前：新引用成为 [1]，方法中的引用变为 [2]。
  expect(ref.textContent).toBe('[1]')
  const saved = await save(services)
  expect(saved.contents.get('a')).toBe('研究现状。[\\[1\\]](writer:cite/b1)')

  await wrapper.findAll('.chapter-tree__row')[1].trigger('click')
  await flushPromises()
  expect(editorView(wrapper).dom.querySelector('.chapter-ref')!.textContent).toBe('[2]')
})

test('参考文献对话框：新建并填写，完成后保存为文档内容；取消不修改', async () => {
  const { services, wrapper } = await openDocument([])
  services.shell.chooseMenuItem('insert:references')
  await flushPromises()
  expect(wrapper.find('.references__empty').exists()).toBe(true)
  await button(wrapper, '新建文献').trigger('click')
  await flushPromises()
  await wrapper.find('#reference-type').setValue('article')
  await wrapper.find('#reference-field-author').setValue('王五')
  await wrapper.find('#reference-field-title').setValue('题名')
  await wrapper.find('#reference-field-container').setValue('刊名')
  await wrapper.find('#reference-field-year').setValue('2022')
  expect(wrapper.find('.references__preview').text()).toBe('王五. 题名[J]. 刊名, 2022.')
  await wrapper.find('form.references').trigger('submit')
  await flushPromises()
  const saved = await save(services)
  expect(saved.references).toHaveLength(1)
  expect(saved.references[0]).toMatchObject({ type: 'article', author: '王五', title: '题名', container: '刊名', year: '2022' })

  services.shell.chooseMenuItem('insert:references')
  await flushPromises()
  await button(wrapper, '删除').trigger('click')
  await button(wrapper, '取消').trigger('click')
  await flushPromises()
  expect((await save(services)).references).toHaveLength(1)
})

test('删除被引用的文献先确认；删除后引用显示为失效', async () => {
  const { services, wrapper } = await openDocument()
  await wrapper.findAll('.chapter-tree__row')[1].trigger('click')
  await flushPromises()
  services.shell.chooseMenuItem('insert:references')
  await flushPromises()
  await wrapper.findAll('.references__item')[1].trigger('click')
  services.shell.confirmAnswer = true
  await button(wrapper, '删除').trigger('click')
  await flushPromises()
  expect(services.shell.confirmations.at(-1)).toContain('被引用了 1 处')
  await wrapper.find('form.references').trigger('submit')
  await flushPromises()
  expect(editorView(wrapper).dom.querySelector('.chapter-ref')!.classList.contains('is-broken')).toBe(true)
})

test('文献浮层中没有文献时可以直接添加，完成后回到浮层', async () => {
  const { services, wrapper } = await openDocument([])
  placeCaretAtEnd(wrapper)
  services.shell.chooseMenuItem('editor:citation')
  await flushPromises()
  expect(wrapper.find('.citation-picker').text()).toContain('还没有参考文献')
  await button(wrapper, '添加文献…').trigger('click')
  await flushPromises()
  await button(wrapper, '新建文献').trigger('click')
  await wrapper.find('#reference-field-title').setValue('新书')
  await wrapper.find('form.references').trigger('submit')
  await flushPromises()
  expect(wrapper.findAll('.citation-picker [role="option"]').map((o) => o.text())).toEqual(['新书[M].'])
})
