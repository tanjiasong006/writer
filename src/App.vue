<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
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
import Toast from './ui/common/Toast.vue'
import { menuItemForKey, parseMenuItemId, welcomeMenus } from './ui/app_shell/app_menu.ts'
import { useAppearance } from './ui/app_shell/use_appearance.ts'
import { useUpdates } from './ui/app_shell/use_updates.ts'
import {
  clearRecentProjects,
  forgetRecentProject,
  recentProjects,
  rememberRecentProject,
} from './application/recent_projects.ts'
import UpdateDialog from './ui/app_shell/UpdateDialog.vue'
import { blockReload, isHandled } from './ui/common/shortcuts.ts'
import './ui/base.css'

/**
 * 应用入口：管理"当前打开的项目"。
 * 启动时重新打开上次的项目；切换项目或关闭窗口前经 releaseSession 保存，
 * 保存失败时由用户决定是否丢弃，绝不静默丢失修改。
 */
const { storage, shell } = useServices()
const appearance = useAppearance(shell)

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
 * 网页默认的右键菜单（重新载入、检查元素……）不属于桌面应用：界面中有意义的位置（章节、正文）有自己的右键菜单，
 * 其他位置右键不弹出任何菜单。输入框保留系统的剪切 / 拷贝 / 粘贴菜单；选中了文字时保留系统的拷贝菜单。
 */
function blockPageContextMenu(event: MouseEvent): void {
  if (event.defaultPrevented) return
  const target = event.target as HTMLElement | null
  if (target?.closest?.('input, textarea')) return
  if (!(window.getSelection()?.isCollapsed ?? true)) return
  event.preventDefault()
}

/**
 * 没有打开文档时的菜单栏与快捷键（新建、打开、外观）。打开文档后由工作区设置完整的菜单栏并响应快捷键。
 */
/** 最近打开的项目（文件 → 打开最近、欢迎页）。 */
const recent = ref<string[]>(recentProjects(shell))

const welcome = computed(() => welcomeMenus(appearance.current.value, recent.value))

function runWelcomeMenuItem(id: string): void {
  if (view.value.kind === 'open') return
  const command = parseMenuItemId(id)
  if (command?.group === 'appearance') appearance.set(command.appearance)
  if (command?.group === 'app') void updates.check()
  if (busy.value) return
  if (command?.group === 'recent') void openRecent(command.index)
  else if (id === 'file:new') void newProject()
  else if (id === 'file:open') void openExisting()
}

watch(
  [() => view.value.kind, welcome],
  ([kind, menus]) => {
    if (kind !== 'open') shell.setAppMenu?.(menus, runWelcomeMenuItem)
  },
  { immediate: true },
)

function onShortcut(event: KeyboardEvent): void {
  if (isHandled(event) || view.value.kind === 'open') return
  const id = menuItemForKey(welcome.value, event)
  if (id === null) return
  event.preventDefault()
  runWelcomeMenuItem(id)
}

onMounted(() => {
  window.addEventListener('dragover', blockFileDragOver)
  window.addEventListener('drop', blockFileDrop)
  // 刷新页面（F5、Ctrl/Cmd+R；Windows 的 WebView2 默认响应）会绕过关闭时的保存流程，
  // 丢掉尚未自动保存的输入。桌面应用中没有需要刷新的场景，直接屏蔽（shortcuts.ts）。
  window.addEventListener('keydown', blockReload)
  window.addEventListener('keydown', onShortcut)
  window.addEventListener('contextmenu', blockPageContextMenu)
})

onBeforeUnmount(() => {
  window.removeEventListener('dragover', blockFileDragOver)
  window.removeEventListener('drop', blockFileDrop)
  window.removeEventListener('keydown', blockReload)
  window.removeEventListener('keydown', onShortcut)
  window.removeEventListener('contextmenu', blockPageContextMenu)
})

onMounted(async () => {
  // 窗口标题是应用名（开发版为 "Writer Dev"，便于与正式版区分）；打开文档后由工作区改为文档名。
  shell.setWindowTitle(shell.appName)
  stopCloseGuard = shell.onCloseRequested(leaveCurrent)
  const last = shell.startupProjectPath() ?? shell.getLastProjectPath()
  if (last === null) {
    view.value = { kind: 'welcome' }
    return
  }
  await enter(() => openProject(storage, last))
})

onBeforeUnmount(() => stopCloseGuard?.())

/** 检查更新：重新启动前与关闭窗口相同，先保存并释放当前项目。 */
const updates = useUpdates(shell, () => leaveCurrent())
onMounted(() => updates.scheduleBackgroundCheck())

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
    recent.value = rememberRecentProject(shell, result.session.path)
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

/** 打开最近的第 index 个项目（null 清除列表）；打不开的从列表中去掉。 */
async function openRecent(index: number | null): Promise<void> {
  if (index === null) {
    recent.value = clearRecentProjects(shell)
    return
  }
  const path = recent.value[index]
  if (path !== undefined) await openRecentPath(path)
}

async function openRecentPath(path: string): Promise<void> {
  const current = view.value
  if (current.kind === 'open' && current.session.path === path) return
  await switchTo(() => openProject(storage, path))
  const opened = view.value.kind === 'open' && view.value.session.path === path
  if (!opened) recent.value = forgetRecentProject(shell, path)
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
    <Workspace
      v-if="view.kind === 'open'"
      :key="view.key"
      :session="view.session"
      :notice="notice"
      :appearance="appearance.current.value"
      @dismiss-notice="notice = null"
      @set-appearance="appearance.set"
      :update-notice="updates.notice.value"
      :recent="recent"
      @open-recent="openRecent"
      @new-project="newProject"
      @open-project="openExisting"
      @check-update="updates.check"
      @show-update="updates.showAvailable"
      @dismiss-update="updates.dismissNotice"
    />
    <template v-else-if="view.kind === 'welcome'">
      <WelcomeView
        :error="error"
        :busy="busy"
        :recent="recent"
        @new-project="newProject"
        @open-project="openExisting"
        @open-recent="openRecentPath"
      />
      <div v-if="notice || updates.notice.value" class="app__toasts">
        <Toast v-if="notice" class="app__notice" @dismiss="notice = null">{{ notice }}</Toast>
        <Toast v-if="updates.notice.value" class="app__update" @dismiss="updates.dismissNotice">
          {{ updates.notice.value }}
          <template #actions>
            <button type="button" @click="updates.showAvailable">查看</button>
          </template>
        </Toast>
      </div>
    </template>
    <UpdateDialog
      v-if="updates.dialog.value"
      :state="updates.dialog.value"
      :app-name="shell.appName"
      @install="updates.install"
      @restart="updates.restart"
      @close="updates.close"
    />
  </div>
</template>

<style scoped>
.app__toasts {
  position: fixed;
  right: 0;
  bottom: var(--space-6);
  left: 0;
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  pointer-events: none;
}
</style>
