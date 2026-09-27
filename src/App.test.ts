import { expect, test } from 'vitest'
import { mount } from '@vue/test-utils'
import { nextTick } from 'vue'
import App from './App.vue'
import ChapterTree from './ui/chapter_tree/ChapterTree.vue'

/** 应用入口的最小组合层：持有树与选中态，并把事件接到 Application 用例。 */
function mountApp() {
  return mount(App)
}

test('渲染入口章节树', () => {
  const wrapper = mountApp()
  expect(wrapper.findAll('.chapter-tree__row').map((row) => row.text())).toEqual([
    '1第一章',
    '1.1第一节',
    '2第二章',
  ])
})

test('响应 select，更新选中章节', async () => {
  const wrapper = mountApp()

  wrapper.findComponent(ChapterTree).vm.$emit('select', 'chapter-2')
  await nextTick()

  expect(wrapper.find('.chapter-tree__row--selected').text()).toBe('2第二章')
})

test('响应 move，经 Application 更新章节树', async () => {
  const wrapper = mountApp()

  wrapper.findComponent(ChapterTree).vm.$emit('move', {
    chapterId: 'chapter-2',
    targetChapterId: 'chapter-1-1',
    position: 'before',
  })
  await nextTick()

  expect(wrapper.findAll('.chapter-tree__row').map((row) => row.text())).toEqual([
    '1第一章',
    '1.1第二章',
    '1.2第一节',
  ])
  expect(wrapper.find('[role="alert"]').exists()).toBe(false)
})

test('move 失败时展示 UI 文案且不改变树', async () => {
  const wrapper = mountApp()

  wrapper.findComponent(ChapterTree).vm.$emit('move', {
    chapterId: 'chapter-1',
    targetChapterId: 'chapter-1-1',
    position: 'inside',
  })
  await nextTick()

  expect(wrapper.find('[role="alert"]').text()).toContain('子章节')
  expect(wrapper.findAll('.chapter-tree__row').map((row) => row.text())).toEqual([
    '1第一章',
    '1.1第一节',
    '2第二章',
  ])
})
