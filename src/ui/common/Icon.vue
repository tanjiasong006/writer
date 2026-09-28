<script setup lang="ts">
import { ICONS, type IconName } from './icons.ts'

/** 线条图标；装饰性，含义由所在按钮的 aria-label 表达。 */
defineProps<{ name: IconName }>()
</script>

<template>
  <svg class="icon" viewBox="0 0 16 16" aria-hidden="true"><path :d="ICONS[name]" /></svg>
</template>

<style scoped>
.icon {
  display: block;
  flex: none;
  width: var(--icon-m);
  height: var(--icon-m);
  fill: none;
  stroke: currentColor;
  stroke-width: 1.4;
  stroke-linecap: round;
  stroke-linejoin: round;
}
</style>
