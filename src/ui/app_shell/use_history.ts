import { shallowRef } from 'vue'
import type { ProjectSession } from '../../application/project_session.ts'
import type { SnapshotInfo, StorageFailure } from '../../application/project_storage.ts'

/** 每天自动留下一个版本的间隔。 */
const AUTO_INTERVAL_MS = 24 * 60 * 60 * 1000

/**
 * 版本历史（docs/project-format.md 第 7.1 节）：对话框的状态与操作。
 *
 * - 保存当前版本：先保存未保存的修改，再留下快照。
 * - 恢复：先确认；为当前状态留下“恢复前的版本”，再把选中的版本作为一次普通修改恢复（正常保存提交）。
 * - autoSnapshot：打开文档后调用，距最近一个版本超过一天（或还没有版本）时自动留下一个；失败不打扰。
 */
export function useHistory(options: {
  readonly session: ProjectSession
  readonly confirm: (message: string) => Promise<boolean>
  readonly onError: (failure: StorageFailure) => void
  readonly now?: () => number
}) {
  const open = shallowRef(false)
  const snapshots = shallowRef<readonly SnapshotInfo[] | null>(null)
  const busy = shallowRef(false)
  const now = options.now ?? Date.now

  async function refresh(): Promise<void> {
    const result = await options.session.listSnapshots()
    snapshots.value = result.ok ? result.value : []
    if (!result.ok) options.onError(result.error)
  }

  async function show(): Promise<void> {
    open.value = true
    snapshots.value = null
    await refresh()
  }

  async function run(action: () => Promise<boolean>): Promise<boolean> {
    if (busy.value) return false
    busy.value = true
    try {
      return await action()
    } finally {
      busy.value = false
    }
  }

  function create(label: string): Promise<boolean> {
    return run(async () => {
      const result = await options.session.createSnapshot(label, 'manual')
      if (!result.ok) {
        options.onError(result.error)
        return false
      }
      await refresh()
      return true
    })
  }

  async function restore(snapshot: SnapshotInfo, name: string): Promise<boolean> {
    if (!(await options.confirm(`恢复到“${name}”？\n\n当前内容会先保存为一个版本，之后可以再恢复回来。`))) return false
    return run(async () => {
      const state = await options.session.readSnapshot(snapshot.id)
      if (!state.ok) {
        options.onError(state.error)
        return false
      }
      const before = await options.session.createSnapshot('', 'before-restore')
      if (!before.ok) {
        options.onError(before.error)
        return false
      }
      options.session.restore(state.value)
      open.value = false
      return true
    })
  }

  function remove(snapshot: SnapshotInfo): Promise<boolean> {
    return run(async () => {
      const result = await options.session.deleteSnapshot(snapshot.id)
      if (!result.ok) options.onError(result.error)
      await refresh()
      return result.ok
    })
  }

  async function autoSnapshot(): Promise<void> {
    const list = await options.session.listSnapshots()
    if (!list.ok) return
    const latest = list.value[0]
    if (latest && now() - latest.createdAt < AUTO_INTERVAL_MS) return
    await options.session.createSnapshot('', 'auto')
  }

  return { open, snapshots, busy, show, create, restore, remove, autoSnapshot, close: () => (open.value = false) }
}
