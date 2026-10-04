import { findChapter, type ChapterId, type ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'

/**
 * 项目的界面状态：选中章节与折叠状态，保存在 .writer/ui-state.json。
 * 它只是便利：解析失败、引用了不存在的章节时悄悄丢弃对应部分，不影响文档。
 */
export interface UiState {
  readonly selectedId: ChapterId | null
  readonly collapsedIds: ReadonlySet<ChapterId>
  /** 全文字数目标（docs/decisions.md 第 17 节）；没有时为 null。 */
  readonly goal: number | null
  /** 今天开始写作时的全文字数（计算今日新增）；date 是本地日期 YYYY-MM-DD。 */
  readonly today: { readonly date: string; readonly startWords: number } | null
}

const VERSION = 1

export function serializeUiState(state: UiState): string {
  return JSON.stringify({
    version: VERSION,
    selectedId: state.selectedId,
    collapsedIds: [...state.collapsedIds],
    ...(state.goal === null ? {} : { goal: state.goal }),
    ...(state.today === null ? {} : { today: state.today }),
  })
}

/**
 * 解析界面状态并对照当前章节树清理：已不存在的章节被忽略。
 * 没有可恢复的选中章节时默认选中第一个章节，打开文档就能直接写作。
 */
export function restoreUiState(text: string | null, tree: ChapterTree): UiState {
  let raw: unknown = null
  try {
    raw = text === null ? null : JSON.parse(text)
  } catch {
    raw = null
  }
  const record =
    typeof raw === 'object' && raw !== null && (raw as { version?: unknown }).version === VERSION
      ? (raw as Record<string, unknown>)
      : {}

  const exists = (id: unknown): id is ChapterId =>
    typeof id === 'string' && findChapter(tree, id) !== null

  const selectedId = exists(record.selectedId) ? record.selectedId : (tree[0]?.id ?? null)
  const collapsedIds = new Set(
    Array.isArray(record.collapsedIds) ? record.collapsedIds.filter(exists) : [],
  )
  const goal = typeof record.goal === 'number' && Number.isInteger(record.goal) && record.goal > 0 ? record.goal : null
  const rawToday = record.today as { date?: unknown; startWords?: unknown } | undefined
  const today =
    rawToday && typeof rawToday.date === 'string' && typeof rawToday.startWords === 'number'
      ? { date: rawToday.date, startWords: rawToday.startWords }
      : null
  return { selectedId, collapsedIds, goal, today }
}
