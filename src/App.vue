<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, shallowRef } from 'vue'
import {
  createProject,
  openProject,
  releaseSession,
  type OpenSessionResult,
} from './application/project_lifecycle.ts'
import type { ProjectSession } from './application/project_session.ts'
import type { StorageFailure } from './application/project_storage.ts'
import WelcomeView from './ui/app_shell/WelcomeView.vue'
import Workspace from './ui/app_shell/Workspace.vue'
import { messageForStorageFailure } from './ui/app_shell/storage_messages.ts'
import { useServices } from './ui/services.ts'

/**
 * 应用入口：管理"当前打开的项目"。
 * 启动时重新打开上次的项目；切换项目或关闭窗口前经 releaseSession 保存，
 * 保存失败时由用户决定是否丢弃，绝不静默丢失修改。
 */
const { storage, shell } = useServices()

type View =
  | { readonly kind: 'starting' }
  | { readonly kind: 'welcome' }
  | { readonly kind: 'open'; readonly session: ProjectSession; readonly key: number }

const view = shallowRef<View>({ kind: 'starting' })
const error = ref<string | null>(null)
const notice = ref<string | null>(null)
const busy = ref(false)
let nextKey = 0

let stopCloseGuard: (() => void) | null = null

/**
 * 从系统拖入的文件：没有被编辑器处理（编辑器会插入文本文件的内容）的一律取消。
 * webview 对未处理的文件拖放的默认行为是打开该文件，整个应用页面会被替换。
 */
function isFileDrag(event: DragEvent): boolean {
  return event.dataTransfer?.types.includes('Files') ?? false
}

function blockFileDragOver(event: DragEvent): void {
  if (!isFileDrag(event) || event.defaultPrevented) return
  event.preventDefault()
  if (event.dataTransfer) event.dataTransfer.dropEffect = 'none'
}

function blockFileDrop(event: DragEvent): void {
  if (isFileDrag(event) && !event.defaultPrevented) event.preventDefault()
}

/**
 * 刷新页面（F5、Ctrl/Cmd+R；Windows 的 WebView2 默认响应）会绕过关闭时的保存流程，
 * 丢掉尚未自动保存的输入。桌面应用中没有需要刷新的场景，直接屏蔽。
 */
function blockReload(event: KeyboardEvent): void {
  const reload = event.key === 'F5' || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'r')
  if (reload) event.preventDefault()
}

onMounted(() => {
  window.addEventListener('dragover', blockFileDragOver)
  window.addEventListener('drop', blockFileDrop)
  window.addEventListener('keydown', blockReload)
})

onBeforeUnmount(() => {
  window.removeEventListener('dragover', blockFileDragOver)
  window.removeEventListener('drop', blockFileDrop)
  window.removeEventListener('keydown', blockReload)
})

onMounted(async () => {
  stopCloseGuard = shell.onCloseRequested(leaveCurrent)
  const last = shell.getLastProjectPath()
  if (last === null) {
    view.value = { kind: 'welcome' }
    return
  }
  await enter(() => openProject(storage, last))
})

onBeforeUnmount(() => stopCloseGuard?.())

function confirmDiscard(failure: StorageFailure | null): Promise<boolean> {
  const reason = failure ? messageForStorageFailure(failure) : '保存没有完成。'
  return shell.confirm(`${reason}\n\n仍要放弃尚未保存的修改吗？`, {
    ok: '放弃修改',
    cancel: '返回',
  })
}

/** 正在进行的释放；关闭窗口与退出应用可能同时触发，只执行一次、共享结果。 */
let leaving: Promise<boolean> | null = null

/** 释放当前项目；返回 false 表示用户选择留下。 */
function leaveCurrent(): Promise<boolean> {
  leaving ??= (async () => {
    const current = view.value
    if (current.kind !== 'open') return true
    if (!(await releaseSession(current.session, confirmDiscard))) return false
    view.value = { kind: 'welcome' }
    return true
  })().finally(() => {
    leaving = null
  })
  return leaving
}

/** 进入项目；失败时停在欢迎页并显示原因，返回失败原因（成功返回 null）。 */
async function enter(load: () => Promise<OpenSessionResult>): Promise<string | null> {
  busy.value = true
  error.value = null
  notice.value = null
  try {
    const result = await load()
    if (!result.ok) {
      error.value = messageForStorageFailure(result.error)
      view.value = { kind: 'welcome' }
      return error.value
    }
    shell.setLastProjectPath(result.session.path)
    view.value = { kind: 'open', session: result.session, key: nextKey++ }
    if (result.orphanFiles.length > 0) {
      notice.value = `content 文件夹中有 ${result.orphanFiles.length} 个未被文档引用的文件，已原样保留。`
    }
  } finally {
    busy.value = false
  }
  return null
}

/**
 * 从当前项目切换到另一个项目（新建或打开）。当前项目先保存并释放；
 * 新项目打不开（选错文件夹、目标不为空……）时重新打开原项目并说明原因，
 * 不让一次选错把用户留在欢迎页。
 */
async function switchTo(load: () => Promise<OpenSessionResult>): Promise<void> {
  const current = view.value
  const previous = current.kind === 'open' ? current.session.path : null
  if (!(await leaveCurrent())) return
  const failure = await enter(load)
  if (failure === null || previous === null) return
  if ((await enter(() => openProject(storage, previous))) === null) notice.value = failure
}

async function newProject(): Promise<void> {
  const path = await shell.pickNewProjectPath()
  if (path === null) return
  await switchTo(() => createProject(storage, path, titleFromPath(path)))
}

async function openExisting(): Promise<void> {
  const path = await shell.pickProjectPath()
  if (path === null) return
  await switchTo(() => openProject(storage, path))
}

/** 新文档默认以文件夹名作为标题。 */
function titleFromPath(path: string): string {
  const name = path.split(/[\\/]/).filter(Boolean).pop() ?? ''
  return name.length > 0 ? name : '未命名文档'
}
</script>

<template>
  <div class="app">
    <p v-if="notice" class="app__notice" role="status">
      {{ notice }}
      <button type="button" aria-label="关闭提示" @click="notice = null">×</button>
    </p>
    <Workspace
      v-if="view.kind === 'open'"
      :key="view.key"
      :session="view.session"
      @new-project="newProject"
      @open-project="openExisting"
    />
    <WelcomeView
      v-else-if="view.kind === 'welcome'"
      :error="error"
      :busy="busy"
      @new-project="newProject"
      @open-project="openExisting"
    />
  </div>
</template>

<style scoped>
.app {
  position: relative;
}

.app__notice {
  position: fixed;
  right: 16px;
  bottom: 16px;
  z-index: 30;
  display: flex;
  align-items: center;
  gap: 8px;
  max-width: 28rem;
  margin: 0;
  padding: 8px 12px;
  border: 1px solid #fde68a;
  border-radius: 6px;
  background: #fffbeb;
  font-size: 13px;
}

.app__notice button {
  border: none;
  background: none;
  font-size: 16px;
  cursor: pointer;
}
</style>

<style>
:root {
  font-family: Inter, -apple-system, 'PingFang SC', 'Microsoft YaHei', 'Noto Sans CJK SC', sans-serif;
  font-size: 16px;
  line-height: 24px;
  font-weight: 400;
  /* MVP 只提供浅色主题，组件配色都按浅色设计。 */
  color-scheme: light;
  color: #0f0f0f;
  background-color: #ffffff;

  font-synthesis: none;
  text-rendering: optimizeLegibility;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  -webkit-text-size-adjust: 100%;
}

body {
  margin: 0;
  overflow: hidden;
}

/* WebKit 中表单控件默认使用系统控件字体，不继承界面字体（中文字形会不一致）。 */
button,
input,
select,
textarea {
  font-family: inherit;
}
</style>
