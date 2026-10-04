import type { ChapterStatus } from '../../domain/chapter_tree/chapter_tree.ts'

/** 章节写作状态的名称（菜单、提示中显示）。 */
export const STATUS_LABELS: Readonly<Record<ChapterStatus, string>> = {
  draft: '草稿',
  revise: '待修改',
  done: '完成',
}
