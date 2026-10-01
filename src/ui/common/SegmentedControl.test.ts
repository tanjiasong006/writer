import { afterEach, expect, test } from 'vitest'
import { mount, type VueWrapper } from '@vue/test-utils'
import SegmentedControl from './SegmentedControl.vue'

const options = [
  { value: 'a', label: '甲' },
  { value: 'b', label: '乙' },
  { value: 'c', label: '丙' },
]

const mounted: VueWrapper[] = []
afterEach(() => {
  for (const wrapper of mounted.splice(0)) wrapper.unmount()
})

function render(props: { modelValue: string; disabled?: boolean }) {
  const wrapper = mount(SegmentedControl, {
    props: { options, label: '选项', ...props },
    attachTo: document.body,
  })
  mounted.push(wrapper)
  return wrapper
}

test('单选按钮组：选中项可聚焦，其余不在 Tab 顺序中；点击发出新值', async () => {
  const wrapper = render({ modelValue: 'b' })
  const radios = wrapper.findAll('[role="radio"]')
  expect(wrapper.find('[role="radiogroup"]').attributes('aria-label')).toBe('选项')
  expect(radios.map((r) => r.attributes('aria-checked'))).toEqual(['false', 'true', 'false'])
  expect(radios.map((r) => r.attributes('tabindex'))).toEqual(['-1', '0', '-1'])

  await radios[2].trigger('click')
  expect(wrapper.emitted('update:modelValue')).toEqual([['c']])
  // 点击当前选中项不发出。
  await radios[1].trigger('click')
  expect(wrapper.emitted('update:modelValue')).toHaveLength(1)
})

test('方向键移动并选中相邻项（循环），Home / End 到首末，焦点跟随', async () => {
  const wrapper = render({ modelValue: 'a' })
  const radios = wrapper.findAll('[role="radio"]')
  await radios[0].trigger('keydown', { key: 'ArrowRight' })
  expect(document.activeElement).toBe(radios[1].element)
  await radios[0].trigger('keydown', { key: 'ArrowLeft' })
  await radios[0].trigger('keydown', { key: 'End' })
  expect(wrapper.emitted('update:modelValue')).toEqual([['b'], ['c'], ['c']])
})

test('disabled：不可操作，也不进入 Tab 顺序', () => {
  const wrapper = render({ modelValue: 'a', disabled: true })
  const radios = wrapper.findAll('[role="radio"]')
  expect(radios.every((r) => r.attributes('tabindex') === '-1')).toBe(true)
  expect(radios.every((r) => (r.element as HTMLButtonElement).disabled)).toBe(true)
})
