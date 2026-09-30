<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, shallowRef, watch } from 'vue'
import type { ProjectSession } from '../../application/project_session.ts'
import type { ChapterId } from '../../domain/chapter_tree/chapter_tree.ts'
import { findChapter } from '../../domain/chapter_tree/chapter_tree.ts'
import { computeChapterNumbers } from '../../domain/chapter_numbering/chapter_numbering.ts'
import { hasContent } from '../../domain/document/document.ts'
import { resolveTheme } from '../../domain/document_style/document_style.ts'
import { exportDocument, previewDocument } from '../../application/document_output.ts'
import ChapterManager from '../chapter_tree/ChapterManager.vue'
import SaveStatus from './SaveStatus.vue'
import DocumentTitle from './DocumentTitle.vue'
import ChapterEditor from '../editor/ChapterEditor.vue'
import { useServices } from '../services.ts'
import { useSession } from './use_session.ts'
import { useUiState } from './use_ui_state.ts'
import { useSidebar, SIDEBAR_DEFAULT, SIDEBAR_MIN } from './use_sidebar.ts'
import { usePreview } from './use_preview.ts'
import { useExport } from './use_export.ts'
import { useFocusRegion } from './use_focus_region.ts'
import { useStylePanel } from './use_style_panel.ts'
import { messageForStorageFailure } from './storage_messages.ts'
import { appendImage } from '../editor/markdown.ts'
import DocumentPreview from '../preview/DocumentPreview.vue'
import DocumentStylePanel from '../document_style/DocumentStylePanel.vue'
import type { CommandState, EditorCommand } from '../editor/commands.ts'
import type { SelectedFigure } from '../editor/image_layout.ts'
import PopupMenu, { type MenuAnchor, type MenuEntry } from '../common/PopupMenu.vue'
import Toast from '../common/Toast.vue'
import Icon from '../common/Icon.vue'
import { useMenu } from '../common/use_menu.ts'
import { IS_MAC, SHORTCUTS } from '../common/shortcuts.ts'
import { menuItemForKey, parseMenuItemId, workspaceMenus, type MenuCommand } from './app_menu.ts'

/**
 * 已打开项目的工作区。
 *
 * - 左侧栏：章节树；宽度可拖动调整，可以隐藏（显示 → 隐藏侧栏，或把分隔线拖到最窄处以外）。
 * - 右侧：一行工具栏 + 正文编辑器或全文预览。工具栏开头是文档名（点击打开文档菜单），
 *   右边只放高频操作：插入表格 / 图片，以及预览、文档样式、导出。其余命令在菜单栏、右键菜单与快捷键中。
 * - unified 窗口（macOS）：工具栏与标题栏合为一体，窗口按钮浮在侧栏左上角，工具栏空白处可以拖动窗口。
 * - 菜单栏与快捷键来自同一份菜单（app_menu.ts），可用状态随焦点所在区域变化。
 * - 两侧独立滚动（ui-spec §27）。提示浮在正文区底部，不挤压布局。文档修改一律经 ProjectSession。
 *
 * 各项相对独立的职责在同目录的 use_*.ts 中（界面状态、侧栏、预览、导出、焦点区域、样式面板），
 * 这里负责把它们与菜单命令、章节树、编辑器连接起来。
 */
const props = defineProps<{
  session: ProjectSession
  /** 应用层的提示（如打开项目时的说明），与工作区自己的提示显示在同一处。 */
  notice?: string | null
}>()

const emit = defineEmits<{
  'new-project': []
  'open-project': []
  'dismiss-notice': []
}>()

const { shell, output } = useServices()
const { document, status, lastError } = useSession(props.session)
const unified = shell.windowStyle === 'unified'

/** 工作区内操作（如插入图片、导出）的错误说明；不属于保存状态。 */
const actionError = ref<string | null>(null)
const editor = ref<InstanceType<typeof ChapterEditor> | null>(null)
const chapters = ref<InstanceType<typeof ChapterManager> | null>(null)
const documentTitle = ref<InstanceType<typeof DocumentTitle> | null>(null)

const { selectedId, collapsedIds } = useUiState(shell, props.session.path, () => document.value.tree)

const {
  element: sidebarElement,
  visible: sidebarVisible,
  width: sidebarWidth,
  maxWidth: sidebarMax,
  resizing,
  setWidth: setSidebarWidth,
  setVisible: setSidebarVisible,
  startResize,
  onResizeKey,
} = useSidebar(shell, () => editor.value?.focus())

const {
  open: stylePanelOpen,
  button: styleButton,
  panel: stylePanel,
  show: openStylePanel,
  toggle: toggleStylePanel,
  close: closeStylePanel,
} = useStylePanel({
  lastFocused: () => focus.lastFocused(),
  focusEditor: () => editor.value?.focus(),
})

const focus = useFocusRegion(() => stylePanel.value)
const focusRegion = focus.region

/** 窗口标题显示当前文档名（窗口菜单、调度中心中可见）；离开工作区时恢复为应用名。 */
watch(
  () => document.value.title,
  (title) => shell.setWindowTitle(`${title.trim() || '未命名文档'} — ${shell.appName}`),
  { immediate: true },
)
onBeforeUnmount(() => shell.setWindowTitle(shell.appName))

/** 正文区模式：编辑当前章节，或全文预览。 */
const mode = ref<'edit' | 'preview'>('edit')

const preview = usePreview({
  source: document,
  active: () => mode.value === 'preview',
  render: () => previewDocument(output, props.session.path, document.value),
})
const previewHtml = preview.html
const previewError = preview.error

async function setMode(next: 'edit' | 'preview'): Promise<void> {
  if (mode.value === next) return
  mode.value = next
  scrolled.value = false
  if (next === 'preview') {
    preview.open()
    return
  }
  // 从预览回到编辑：继续在当前章节写作。
  await nextTick()
  editor.value?.focus()
}

function togglePreview(): void {
  void setMode(mode.value === 'edit' ? 'preview' : 'edit')
}

const {
  exporting,
  notice: exportNotice,
  exportAs,
} = useExport({
  shell,
  title: () => document.value.title,
  run: (format, target) => exportDocument(output, props.session.path, document.value, format, target),
  onError: (message) => (actionError.value = message),
})

/** 工具栏按钮菜单（文档菜单、导出）与它们的界面绘制版本（没有系统菜单时）。 */
const menu = useMenu()
/** 打开着菜单的工具栏按钮：按钮保持按下的样子。 */
const openMenuButton = ref<'title' | 'export' | null>(null)

async function showButtonMenu(
  button: 'title' | 'export',
  entries: readonly MenuEntry[],
  anchor: MenuAnchor,
  keyboard: boolean,
): Promise<string | null> {
  openMenuButton.value = button
  const chosen = await menu.open(entries, anchor, keyboard)
  if (openMenuButton.value === button) openMenuButton.value = null
  return chosen
}

const EXPORT_ITEMS: readonly MenuEntry[] = [
  { id: 'docx', label: '导出为 Word（.docx）…' },
  { id: 'pdf', label: '导出为 PDF…' },
]

async function openExportMenu(event: MouseEvent): Promise<void> {
  const rect = (event.currentTarget as HTMLElement).getBoundingClientRect()
  const chosen = await showButtonMenu('export', EXPORT_ITEMS, { rect, align: 'end' }, event.detail === 0)
  if (chosen === 'docx' || chosen === 'pdf') void exportAs(chosen)
}

/** 插入图片：选择文件 → 复制进项目 assets/ → 在发起请求的章节中插入引用。 */
async function insertImage(chapterId: ChapterId): Promise<void> {
  actionError.value = null
  const source = await shell.pickImageFile()
  if (source === null) return
  const result = await props.session.importAsset(source)
  if (!result.ok) {
    actionError.value = messageForStorageFailure(result.error)
    return
  }
  const { reference, fileName } = result.value
  const alt = fileName.replace(/\.[^.]+$/, '')
  if (editor.value?.insertImage(chapterId, reference, alt)) return
  // 选择文件期间切换了章节：追加到发起请求的章节末尾，不插错位置。
  const text = props.session.document.contents.get(chapterId)
  if (text !== undefined) props.session.setContent(chapterId, appendImage(text, reference, alt))
}

/** 正文中的图片引用 → 编辑器中可显示的地址（只显示项目内的文件）。 */
function resolveImage(reference: string): string | null {
  const path = props.session.assetPath(reference)
  return path === null ? null : shell.toDisplayUrl(path)
}

/** 章节树中按 Enter：回到编辑模式并把焦点交给正文编辑器。 */
async function openChapter(): Promise<void> {
  if (mode.value !== 'edit') {
    await setMode('edit')
    return
  }
  await nextTick()
  editor.value?.focus()
}

/** 进入章节树（⌘J）：侧栏隐藏时先显示，焦点落在当前章节上。 */
async function focusTree(): Promise<void> {
  if (!sidebarVisible.value) await setSidebarVisible(true)
  await nextTick()
  chapters.value?.focusCurrent()
}

/** ⌘J：在章节树与正文之间切换；焦点在其他位置（工具栏、预览）时进入章节树。 */
function switchFocus(): void {
  if (focusRegion.value === 'tree') void openChapter()
  else void focusTree()
}

function chapterHasContent(chapterId: ChapterId): boolean {
  return hasContent(document.value, chapterId)
}

/**
 * 只依赖章节树：编辑正文不改变树的引用，computed 值不变时不会触发下游重算，
 * 输入时不必为每次按键重新计算整棵树的编号。
 */
const tree = computed(() => document.value.tree)
const numbers = computed(() => computeChapterNumbers(tree.value))

const selectedChapter = computed(() =>
  selectedId.value === null ? null : findChapter(tree.value, selectedId.value),
)

const selectedNumber = computed(() =>
  selectedId.value === null ? '' : (numbers.value.get(selectedId.value) ?? []).join('.'),
)

/** 文档名：重命名、新建 / 打开其他文档、在访达中显示项目文件夹。 */
const TITLE_ITEMS: readonly MenuEntry[] = [
  { id: 'rename', label: '重命名' },
  { separator: true },
  { id: 'new', label: '新建文档…', shortcut: SHORTCUTS.newDocument },
  { id: 'open', label: '打开文档…', shortcut: SHORTCUTS.openDocument },
  { separator: true },
  { id: 'reveal', label: IS_MAC ? '在访达中显示' : '在文件夹中显示' },
]

async function openTitleMenu(rect: DOMRect, keyboard: boolean): Promise<void> {
  const chosen = await showButtonMenu('title', TITLE_ITEMS, { rect, align: 'start' }, keyboard)
  if (chosen === 'rename') void documentTitle.value?.startRename()
  else if (chosen === 'new') emit('new-project')
  else if (chosen === 'open') emit('open-project')
  else if (chosen === 'reveal') void shell.revealFile(props.session.path)
}

/**
 * 文档样式（整本书的设置，不属于正文工具栏）。与 tree 一样只依赖样式对象：
 * 编辑正文时样式引用不变，主题不会重新解析，编辑器与预览的样式也不会重算。
 */
const documentStyle = computed(() => document.value.style)
const theme = computed(() => resolveTheme(documentStyle.value))

/** 编辑器报告的命令状态与选中的图片（工具栏与菜单栏据此显示可用 / 勾选状态）。 */
const tools = shallowRef<CommandState | null>(null)
const figure = shallowRef<SelectedFigure | null>(null)

function showTools(state: CommandState, selected: SelectedFigure | null): void {
  tools.value = state
  figure.value = selected
}

/** 没有章节时编辑器不存在，它报告的状态随之失效。 */
watch(selectedChapter, (chapter) => {
  if (chapter) return
  tools.value = null
  figure.value = null
})

function runCommand(command: EditorCommand): void {
  editor.value?.runCommand(command)
}

/** 正文滚动离开顶部后，工具栏下方出现一条分隔线，说明内容在它下面继续。 */
const scrolled = ref(false)

function onMainScroll(event: Event): void {
  const target = event.target as HTMLElement
  if (target.classList?.contains('chapter-editor__scroller') || target.classList?.contains('workspace__preview')) {
    scrolled.value = target.scrollTop > 0
  }
}

const NO_MOVES = { up: false, down: false, outdent: false, indent: false } as const

const menus = computed(() =>
  workspaceMenus({
    mode: mode.value,
    focus: focusRegion.value,
    tools: selectedChapter.value ? tools.value : null,
    hasSelectedChapter: selectedChapter.value !== null,
    // 依赖 tree 与 selectedId：结构或选中章节变化时重新计算。
    moves:
      selectedChapter.value && chapters.value && tree.value
        ? {
            up: chapters.value.canMove('up'),
            down: chapters.value.canMove('down'),
            outdent: chapters.value.canMove('outdent'),
            indent: chapters.value.canMove('indent'),
          }
        : NO_MOVES,
    sidebarVisible: sidebarVisible.value,
    exporting: exporting.value !== null,
  }),
)

watch(menus, (next) => shell.setAppMenu?.(next, runMenuItem), { immediate: true })

/** 执行菜单栏（或它的快捷键）中的一项。 */
function runMenuItem(id: string): void {
  const command = parseMenuItemId(id)
  if (command !== null) void runMenuCommand(command)
}

async function runMenuCommand(command: MenuCommand): Promise<void> {
  switch (command.group) {
    case 'editor':
      runCommand(command.command)
      return
    case 'file':
      switch (command.action) {
        case 'new':
          emit('new-project')
          return
        case 'open':
          emit('open-project')
          return
        case 'rename':
          void documentTitle.value?.startRename()
          return
        case 'reveal':
          void shell.revealFile(props.session.path)
          return
        case 'save':
          void props.session.save()
          return
        case 'export-docx':
          void exportAs('docx')
          return
        case 'export-pdf':
          void exportAs('pdf')
          return
      }
      return
    case 'edit':
      if (command.action === 'context-menu') {
        if (focusRegion.value === 'tree') chapters.value?.openChapterMenu()
        else void editor.value?.openMenuAtCaret()
      } else if (focusRegion.value === 'editor') {
        // 正文有自己的撤销历史；普通输入框交给浏览器。
        runCommand(command.action)
      } else {
        globalThis.document.execCommand(command.action)
      }
      return
    case 'format':
      void openStylePanel()
      return
    case 'view':
      if (command.action === 'sidebar') void setSidebarVisible(!sidebarVisible.value)
      else if (command.action === 'preview') togglePreview()
      else switchFocus()
      return
    case 'chapter':
    case 'move-chapter': {
      // 章节命令作用于侧栏中的章节：侧栏隐藏时先显示出来，新建与重命名才看得见。
      const isDelete = command.group === 'chapter' && command.action === 'delete'
      if (!sidebarVisible.value && !isDelete) await setSidebarVisible(true)
      const manager = chapters.value
      if (!manager) return
      if (command.group === 'move-chapter') {
        manager.moveChapter(command.direction)
        return
      }
      switch (command.action) {
        case 'new':
          manager.createChapter()
          return
        case 'new-child':
          manager.createChildChapter()
          return
        case 'rename':
          manager.renameChapter()
          return
        case 'delete':
          manager.deleteChapter()
          return
      }
    }
  }
}

/**
 * 快捷键：按菜单栏中的同一份快捷键执行。已被焦点处（正文、章节树、输入框）处理的按键不再处理；
 * macOS 上系统菜单栏会先于或代替这里响应，同一次按键只执行一次。
 */
function onKeydown(event: KeyboardEvent): void {
  if (event.defaultPrevented) return
  const id = menuItemForKey(menus.value, event)
  if (id !== null) {
    event.preventDefault()
    runMenuItem(id)
    return
  }
  // 全文预览中按 Esc 回到编辑（菜单、面板、对话框、重命名自己处理的 Esc 不会走到这里）。
  if (event.key === 'Escape' && mode.value === 'preview') {
    event.preventDefault()
    void setMode('edit')
  }
}

onMounted(() => window.addEventListener('keydown', onKeydown))
onBeforeUnmount(() => window.removeEventListener('keydown', onKeydown))

/**
 * 保存失败的完整原因以提示条给出；关闭后工具栏中的"保存失败"仍在，下一次失败（原因可能不同）再次显示。
 */
const saveErrorDismissed = ref(false)
watch(lastError, () => (saveErrorDismissed.value = false))

/** 没有章节时正文区的主要操作：新建第一个章节（与侧栏中的按钮相同）。 */
async function createFirstChapter(): Promise<void> {
  if (!sidebarVisible.value) await setSidebarVisible(true)
  chapters.value?.createChapter()
}
</script>


<template>
  <div
    class="workspace"
    :class="{
      'workspace--unified': unified,
      'workspace--resizing': resizing,
      'workspace--sidebar-hidden': !sidebarVisible,
    }"
    :style="{ '--sidebar-w': `${sidebarWidth}px` }"
    :data-save-status="status"
  >
    <aside v-show="sidebarVisible" ref="sidebarElement" class="workspace__sidebar" aria-label="文档结构">
      <!-- unified 窗口：侧栏顶部是标题栏的一部分，左边是窗口按钮，右边是侧栏开关。 -->
      <div v-if="unified" class="workspace__sidebar-bar" data-tauri-drag-region>
        <button
          type="button"
          class="workspace__tool"
          tabindex="0"
          aria-label="隐藏侧栏"
          title="隐藏侧栏"
          @click="setSidebarVisible(false)"
        >
          <Icon name="sidebar" />
        </button>
      </div>

      <ChapterManager
        ref="chapters"
        v-model:selected-id="selectedId"
        v-model:collapsed-ids="collapsedIds"
        class="workspace__chapters"
        :tree="document.tree"
        :has-content="chapterHasContent"
        @update:tree="session.applyTree($event)"
        @open="openChapter"
      />

      <div
        class="workspace__resizer"
        role="separator"
        aria-orientation="vertical"
        aria-label="调整侧栏宽度"
        :aria-valuenow="sidebarWidth"
        :aria-valuemin="SIDEBAR_MIN"
        :aria-valuemax="sidebarMax"
        tabindex="0"
        @pointerdown="startResize"
        @dblclick="setSidebarWidth(SIDEBAR_DEFAULT)"
        @keydown="onResizeKey"
      ></div>
    </aside>

    <main class="workspace__main" @scroll.capture="onMainScroll">
      <header class="workspace__bar" :class="{ 'workspace__bar--scrolled': scrolled }" data-tauri-drag-region>
        <button
          v-if="!sidebarVisible || !unified"
          type="button"
          class="workspace__tool"
          tabindex="0"
          :aria-label="sidebarVisible ? '隐藏侧栏' : '显示侧栏'"
          :aria-pressed="sidebarVisible"
          :title="sidebarVisible ? '隐藏侧栏' : '显示侧栏'"
          @click="setSidebarVisible(!sidebarVisible)"
        >
          <Icon name="sidebar" />
        </button>

        <DocumentTitle
          ref="documentTitle"
          class="workspace__title"
          :class="{ 'workspace__title--open': openMenuButton === 'title' }"
          :title="document.title"
          @menu="openTitleMenu"
          @rename="session.setTitle($event)"
        />
        <SaveStatus
          v-if="status === 'failed'"
          class="workspace__save-status"
          :status="status"
          :error="lastError"
          @retry="session.save()"
        />

        <div class="workspace__spacer" data-tauri-drag-region></div>

        <div v-if="mode === 'edit' && selectedChapter" class="workspace__group" role="toolbar" aria-label="插入">
          <button
            type="button"
            class="workspace__tool"
            tabindex="0"
            aria-label="插入表格"
            title="插入表格"
            :disabled="tools !== null && !tools.table.enabled"
            @mousedown.prevent
            @click="runCommand('table')"
          >
            <Icon name="table" />
          </button>
          <button
            type="button"
            class="workspace__tool"
            tabindex="0"
            aria-label="插入图片"
            title="插入图片…"
            :disabled="tools !== null && !tools.image.enabled"
            @mousedown.prevent
            @click="runCommand('image')"
          >
            <Icon name="image" />
          </button>
        </div>

        <div class="workspace__group" role="toolbar" aria-label="文档">
          <button
            type="button"
            class="workspace__tool"
            tabindex="0"
            :class="{ 'workspace__tool--on': mode === 'preview' }"
            aria-label="全文预览"
            :aria-pressed="mode === 'preview'"
            :title="mode === 'preview' ? '回到编辑（Esc）' : '全文预览'"
            @click="togglePreview"
          >
            <Icon name="preview" />
          </button>
          <div class="workspace__anchor">
            <button
              ref="styleButton"
              type="button"
              class="workspace__tool"
              tabindex="0"
              :class="{ 'workspace__tool--open': stylePanelOpen }"
              aria-label="文档样式"
              aria-haspopup="dialog"
              :aria-expanded="stylePanelOpen"
              title="文档样式：整本文档的主题、字体与字号"
              @click="toggleStylePanel"
            >
              <Icon name="style" />
            </button>
            <div
              v-if="stylePanelOpen"
              ref="stylePanel"
              class="workspace__popover"
              role="dialog"
              aria-label="文档样式"
              tabindex="-1"
              @keydown.esc="closeStylePanel"
            >
              <DocumentStylePanel
                :document-style="documentStyle"
                @select-theme="session.selectTheme($event)"
                @override="session.overrideStyle($event)"
                @reset="session.resetStyleOverrides()"
              />
            </div>
          </div>
          <button
            type="button"
            class="workspace__tool"
            tabindex="0"
            :class="{ 'workspace__tool--open': openMenuButton === 'export', 'workspace__tool--busy': exporting }"
            aria-label="导出"
            aria-haspopup="menu"
            :aria-expanded="openMenuButton === 'export'"
            :disabled="exporting !== null"
            :title="exporting ? '正在导出…' : '导出为 Word 或 PDF'"
            @click="openExportMenu"
          >
            <Icon name="export" />
          </button>
        </div>
      </header>

      <div class="workspace__content">
        <div v-if="mode === 'preview'" class="workspace__preview">
          <p v-if="previewError" class="workspace__preview-error" role="alert">{{ previewError }}</p>
          <DocumentPreview
            :html="previewHtml"
            :active-chapter-id="selectedId"
            :to-display-url="shell.toDisplayUrl"
            :theme="theme"
            @select="selectedId = $event"
          />
        </div>
        <ChapterEditor
          v-else-if="selectedChapter && selectedId !== null"
          ref="editor"
          :chapter-id="selectedId"
          :content="document.contents.get(selectedId) ?? ''"
          :number="selectedNumber"
          :title="selectedChapter.title"
          :resolve-image="resolveImage"
          :theme="theme"
          :image-layouts="documentStyle.images"
          @change="(chapterId, text) => session.setContent(chapterId, text)"
          @request-image="insertImage"
          @image-layout="(key, layout) => session.setImageLayout(key, layout)"
          @tools="showTools"
        />
        <div v-else class="workspace__placeholder">
          <template v-if="document.tree.length === 0">
            <p>这份文档还没有章节。</p>
            <!-- 侧栏中已有"新建第一个章节"；侧栏隐藏时才在这里给出同样的操作。 -->
            <button v-if="!sidebarVisible" type="button" class="workspace__placeholder-action" tabindex="0" @click="createFirstChapter">
              新建章节
            </button>
          </template>
          <p v-else>在左侧选择一个章节，开始写作。</p>
        </div>
      </div>

      <div class="workspace__toasts">
        <Toast v-if="notice" class="app__notice" @dismiss="emit('dismiss-notice')">{{ notice }}</Toast>
        <Toast
          v-if="status === 'failed' && lastError && !saveErrorDismissed"
          class="workspace__save-error"
          tone="error"
          @dismiss="saveErrorDismissed = true"
        >
          {{ messageForStorageFailure(lastError) }} 修改仍在，稍后会自动再试。
          <template #actions>
            <button type="button" @click="session.save()">重试</button>
          </template>
        </Toast>
        <Toast v-if="actionError" class="workspace__error" tone="error" @dismiss="actionError = null">
          {{ actionError }}
        </Toast>
        <Toast v-if="exportNotice" class="workspace__notice" @dismiss="exportNotice = null">
          {{ exportNotice.message }}
          <template #actions>
            <button type="button" @click="shell.revealFile(exportNotice.path)">
              {{ IS_MAC ? '在访达中显示' : '在文件夹中显示' }}
            </button>
          </template>
        </Toast>
      </div>
    </main>

    <PopupMenu
      v-if="menu.current.value"
      label="菜单"
      backdrop-class="workspace__backdrop"
      :items="menu.current.value.entries"
      :anchor="menu.current.value.anchor"
      :keyboard="menu.current.value.keyboard"
      @select="menu.select"
      @close="menu.close"
    />
  </div>
</template>

<style scoped>
.workspace {
  --toolbar-h: var(--header-h);
  display: flex;
  height: 100vh;
}

/* macOS 合一的标题栏与工具栏：52pt，窗口按钮在侧栏顶部垂直居中。 */
.workspace--unified {
  --toolbar-h: var(--toolbar-h-unified);
}

.workspace--resizing {
  cursor: col-resize;
  -webkit-user-select: none;
  user-select: none;
}

/* 侧栏：略带色调的安静表面，与正文区之间只有一条细分隔线。 */
.workspace__sidebar {
  position: relative;
  display: flex;
  flex: none;
  flex-direction: column;
  width: var(--sidebar-w);
  min-height: 0;
  border-right: 1px solid var(--color-separator);
  background: var(--color-bg-sidebar);
  -webkit-user-select: none;
  user-select: none;
}

/* 普通标题栏：章节树的标题行与右侧工具栏垂直居中对齐。 */
.workspace:not(.workspace--unified) .workspace__sidebar {
  padding-top: calc((var(--toolbar-h) - var(--tree-row-h)) / 2);
}

.workspace__sidebar-bar {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: flex-end;
  height: var(--toolbar-h);
  padding: 0 var(--space-4);
}

.workspace__chapters {
  flex: 1;
  min-height: 0;
}

/* 分隔线本身是 1px 的边框；可拖动区域更宽，悬停或拖动时以强调色显示。 */
.workspace__resizer {
  position: absolute;
  top: 0;
  right: -4px;
  bottom: 0;
  z-index: 5;
  width: 7px;
  cursor: col-resize;
}

.workspace__resizer::after {
  position: absolute;
  top: 0;
  bottom: 0;
  left: 3px;
  width: 1px;
  content: '';
  background: transparent;
  transition: background-color var(--duration-base) var(--ease-out);
}

.workspace__resizer:hover::after,
.workspace--resizing .workspace__resizer::after {
  background: var(--color-accent);
  transition-delay: 120ms;
}

.workspace__resizer:focus-visible {
  outline: none;
}

.workspace__resizer:focus-visible::after {
  left: 2px;
  width: 3px;
  background: var(--color-focus-ring);
}

.workspace__main {
  position: relative;
  display: flex;
  flex: 1;
  flex-direction: column;
  min-width: 0;
  background: var(--color-bg);
}

/* 工具栏：与正文同底色，没有边框；正文滚动离开顶部后才出现分隔线。 */
.workspace__bar {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-2);
  height: var(--toolbar-h);
  box-sizing: border-box;
  padding: 0 var(--space-4) 0 var(--space-5);
  box-shadow: 0 1px 0 transparent;
  transition: box-shadow var(--duration-base) var(--ease-out);
  -webkit-user-select: none;
  user-select: none;
}

/* 侧栏隐藏时工具栏延伸到窗口左边缘：为窗口按钮留出位置。 */
.workspace--unified.workspace--sidebar-hidden .workspace__bar {
  padding-left: var(--traffic-lights-w);
}

.workspace__bar--scrolled {
  box-shadow: 0 1px 0 var(--color-separator);
}

.workspace__title {
  flex: 0 1 auto;
  min-width: 0;
}

.workspace__title--open :deep(.document-title__button) {
  background: var(--color-fill-hover);
}

.workspace__save-status {
  flex: none;
  margin-left: var(--space-2);
}

.workspace__spacer {
  flex: 1;
  align-self: stretch;
  min-width: var(--space-5);
}

.workspace__group {
  display: flex;
  flex: none;
  align-items: center;
  gap: var(--space-1);
}

/* 两组按钮之间留出比组内更大的间距，不用分隔线。 */
.workspace__group + .workspace__group {
  margin-left: var(--space-5);
}

.workspace__anchor {
  position: relative;
}

/* 工具栏按钮：无边框的图标按钮，默认次级前景色；hover 出现浅底，打开 / 开启时保持按下的样子。 */
.workspace__tool {
  display: flex;
  flex: none;
  align-items: center;
  justify-content: center;
  width: var(--control-h-m);
  height: var(--control-h-m);
  padding: 0;
  border: none;
  border-radius: var(--radius-m);
  background: none;
  color: var(--color-text-secondary);
  transition: background-color var(--duration-fast) var(--ease-out), color var(--duration-fast) var(--ease-out);
}

.workspace__tool:hover:not(:disabled),
.workspace__tool--open {
  background: var(--color-fill-hover);
  color: var(--color-text);
}

.workspace__tool:active:not(:disabled) {
  background: var(--color-fill-pressed);
}

.workspace__tool--on,
.workspace__tool--on:hover:not(:disabled) {
  background: var(--color-accent-fill);
  color: var(--color-accent-text);
}

.workspace__tool:disabled {
  color: var(--color-text-disabled);
}

/* 导出进行中：按钮不可用，图标缓慢闪动说明正在工作。 */
.workspace__tool--busy .icon {
  animation: workspace-busy 1.2s ease-in-out infinite;
}

@keyframes workspace-busy {
  50% {
    opacity: 0.35;
  }
}

.workspace__popover {
  position: absolute;
  top: calc(100% + var(--space-2));
  right: 0;
  z-index: calc(var(--z-popover) + 1);
  border-radius: var(--radius-l);
  background: var(--color-bg-raised);
  box-shadow: var(--shadow-popover);
  outline: none;
  animation: workspace-popover-in var(--duration-fast) var(--ease-out);
}

@keyframes workspace-popover-in {
  from {
    opacity: 0;
    transform: translateY(-2px);
  }
}

.workspace__backdrop {
  position: fixed;
  inset: 0;
  z-index: var(--z-popover);
}

.workspace__content {
  flex: 1;
  min-height: 0;
}

.workspace__preview {
  height: 100%;
  overflow-y: auto;
}

.workspace__preview-error {
  max-width: var(--doc-column);
  box-sizing: border-box;
  margin: var(--space-6) auto 0;
  padding: 0 var(--doc-gutter);
  color: var(--color-danger-text);
  font-size: var(--text-m);
}

/* 没有打开章节：一句说明 + 主要操作，垂直居中在正文区（扣除工具栏高度，视觉上居中）。 */
.workspace__placeholder {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: var(--space-5);
  height: 100%;
  padding-bottom: var(--toolbar-h);
  box-sizing: border-box;
  color: var(--color-text-tertiary);
  font-size: var(--text-l);
}

.workspace__placeholder p {
  margin: 0;
}

.workspace__placeholder-action {
  height: var(--control-h-m);
  padding: 0 var(--space-6);
  border: none;
  border-radius: var(--radius-m);
  background: var(--color-fill-hover);
  box-shadow: inset 0 0 0 1px var(--color-separator);
  color: var(--color-text);
  font: inherit;
  font-size: var(--text-m);
  font-weight: var(--weight-medium);
}

.workspace__placeholder-action:hover {
  background: var(--color-fill-pressed);
}

.workspace__toasts {
  position: absolute;
  right: 0;
  bottom: var(--space-6);
  left: 0;
  z-index: var(--z-toast);
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: var(--space-4);
  padding: 0 var(--space-6);
  pointer-events: none;
}
</style>
