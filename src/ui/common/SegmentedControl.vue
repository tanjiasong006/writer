<script setup lang="ts" generic="T extends string | number">
import { ref } from 'vue'

/**
 * 分段控件：从少量互斥选项中选一个（单选按钮组）。
 *
 * - 键盘：整组只占一个 Tab 位置（选中项）；←/→（以及 ↑/↓）移动并选中相邻项，Home / End 到首 / 末。
 * - disabled 时整组不可操作，也不进入 Tab 顺序。
 * - 只发出 update:modelValue，不持有状态。
 */
const props = defineProps<{
  modelValue: T
  options: readonly { readonly value: T; readonly label: string }[]
  /** 整组的无障碍名称。 */
  label: string
  disabled?: boolean
}>()

const emit = defineEmits<{ 'update:modelValue': [value: T] }>()

const buttons = ref<HTMLButtonElement[]>([])

function select(index: number): void {
  const option = props.options[(index + props.options.length) % props.options.length]
  if (option.value !== props.modelValue) emit('update:modelValue', option.value)
  buttons.value[props.options.indexOf(option)]?.focus()
}

function onKeydown(event: KeyboardEvent, index: number): void {
  const last = props.options.length - 1
  const next =
    event.key === 'ArrowRight' || event.key === 'ArrowDown'
      ? index + 1
      : event.key === 'ArrowLeft' || event.key === 'ArrowUp'
        ? index - 1
        : event.key === 'Home'
          ? 0
          : event.key === 'End'
            ? last
            : null
  if (next === null) return
  event.preventDefault()
  select(next)
}
</script>

<template>
  <div
    class="segmented"
    :class="{ 'segmented--disabled': disabled }"
    role="radiogroup"
    :aria-label="label"
    :aria-disabled="disabled || undefined"
  >
    <button
      v-for="(option, index) in options"
      :key="String(option.value)"
      ref="buttons"
      type="button"
      role="radio"
      class="segmented__option"
      :class="{ 'segmented__option--selected': option.value === modelValue }"
      :aria-checked="option.value === modelValue"
      :tabindex="!disabled && option.value === modelValue ? 0 : -1"
      :disabled="disabled"
      @click="select(index)"
      @keydown="onKeydown($event, index)"
    >
      {{ option.label }}
    </button>
  </div>
</template>

<style scoped>
.segmented {
  display: inline-flex;
  box-sizing: border-box;
  height: var(--control-h-s);
  padding: var(--space-1);
  gap: var(--space-1);
  border-radius: var(--radius-m);
  background: var(--color-fill-hover);
  box-shadow: inset 0 0 0 1px var(--color-separator);
}

.segmented__option {
  min-width: 44px;
  padding: 0 var(--space-4);
  border: none;
  border-radius: var(--radius-s);
  background: none;
  color: var(--color-text-secondary);
  font: inherit;
  font-size: var(--text-s);
  line-height: 1;
  white-space: nowrap;
  transition:
    background-color var(--duration-fast) var(--ease-out),
    color var(--duration-fast) var(--ease-out);
}

.segmented__option:hover:not(:disabled) {
  color: var(--color-text);
}

/* 选中项像一块抬起的按钮，不用强调色抢注意力。 */
.segmented__option--selected {
  background: var(--color-control-selected);
  box-shadow: 0 0 0 0.5px var(--color-control-border), 0 1px 2px rgba(0, 0, 0, 0.08);
  color: var(--color-text);
  font-weight: var(--weight-medium);
}

.segmented__option:focus-visible {
  outline: 2px solid var(--color-focus-ring);
  outline-offset: 1px;
}

.segmented--disabled {
  opacity: 0.5;
}
</style>
