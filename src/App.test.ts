import { expect, test } from 'vitest'
import { mount } from '@vue/test-utils'
import App from './App.vue'

test('应用入口挂载章节管理组件并显示初始章节', () => {
  const wrapper = mount(App)

  expect(wrapper.find('[role="toolbar"]').exists()).toBe(true)
  expect(wrapper.findAll('.chapter-tree__row').map((row) => row.text())).toEqual([
    '1第一章',
    '1.1第一节',
    '2第二章',
  ])
})
