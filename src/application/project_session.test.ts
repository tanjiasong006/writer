import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import type { ChapterTree } from '../domain/chapter_tree/chapter_tree.ts'
import { createDocument, type WriterDocument } from '../domain/document/document.ts'
import { MemoryProjectStorage } from '../testing/memory_project_storage.ts'
import { ProjectSession } from './project_session.ts'
import { createProject, openProject, releaseSession } from './project_lifecycle.ts'
import { appendChapter } from './create_chapter.ts'
import { moveChapterTo } from './move_chapter.ts'
import { removeChapter } from './remove_chapter.ts'

const PATH = '/文档/论文'

const tree: ChapterTree = [
  { id: 'a', title: '绪论', children: [{ id: 'a1', title: '背景', children: [] }] },
  { id: 'b', title: '方法', children: [] },
]

function initialDocument(): WriterDocument {
  const result = createDocument(
    '论文',
    tree,
    new Map([
      ['a', '引言'],
      ['a1', '背景正文'],
      ['b', ''],
    ]),
  )
  if (!result.ok) throw new Error('fixture')
  return result.document
}

function setup(options: { autosaveDelayMs?: number | null; retryDelayMs?: number } = {}) {
  const storage = new MemoryProjectStorage()
  storage.seed(PATH, initialDocument())
  const session = new ProjectSession(storage, PATH, initialDocument(), {
    autosaveDelayMs: null,
    ...options,
  })
  return { storage, session }
}

function committedContents(storage: MemoryProjectStorage) {
  return Object.fromEntries(storage.committed(PATH)!.contents)
}

beforeEach(() => {
  vi.useFakeTimers()
})

afterEach(() => {
  vi.useRealTimers()
})

test('新打开的会话是 clean', () => {
  const { session } = setup()
  expect(session.isDirty).toBe(false)
  expect(session.status).toBe('saved')
})

test('修改正文后 dirty，保存只携带变化的章节，成功后 clean', async () => {
  const { storage, session } = setup()
  expect(session.setContent('a1', '新的背景')).toBe(true)
  expect(session.status).toBe('dirty')

  expect(await session.save()).toBe(true)
  expect([...storage.saves[0].changed]).toEqual(['a1'])
  expect(session.status).toBe('saved')
  expect(committedContents(storage)).toEqual({ a: '引言', a1: '新的背景', b: '' })
})

test('新建章节：新章节的空正文随保存提交', async () => {
  const { storage, session } = setup()
  const created = appendChapter(session.document.tree, null, '结论')
  if (!created.ok) throw new Error('fixture')
  session.applyTree(created.tree)

  await session.save()
  expect([...storage.saves[0].changed]).toEqual([created.chapterId])
  expect(storage.committed(PATH)!.contents.get(created.chapterId)).toBe('')
})

test('只调整结构：不携带任何正文，正文由存储层保留', async () => {
  const { storage, session } = setup()
  const moved = moveChapterTo(session.document.tree, {
    chapterId: 'b',
    targetChapterId: 'a',
    position: 'before',
  })
  if (!moved.ok) throw new Error('fixture')
  session.applyTree(moved.tree)
  expect(session.isDirty).toBe(true)

  await session.save()
  expect(storage.saves[0].changed.size).toBe(0)
  expect(storage.committed(PATH)!.tree.map((node) => node.id)).toEqual(['b', 'a'])
  expect(committedContents(storage)).toEqual({ a: '引言', a1: '背景正文', b: '' })
})

test('删除含子章节的章节：保存后磁盘上不再有其正文', async () => {
  const { storage, session } = setup()
  const removed = removeChapter(session.document.tree, 'a')
  if (!removed.ok) throw new Error('fixture')
  session.applyTree(removed.tree)
  await session.save()
  expect(committedContents(storage)).toEqual({ b: '' })
})

test('保存失败：保持 dirty 并暴露错误；之后重试成功才变 clean', async () => {
  const { storage, session } = setup()
  session.setContent('b', '方法正文')
  storage.failNext({ code: 'io', operation: 'write', path: 'x', message: 'disk full' })

  expect(await session.save()).toBe(false)
  expect(session.isDirty).toBe(true)
  expect(session.status).toBe('failed')
  expect(session.lastError?.code).toBe('io')
  expect(storage.committed(PATH)!.contents.get('b')).toBe('')

  expect(await session.save()).toBe(true)
  expect(session.status).toBe('saved')
  expect(session.lastError).toBeNull()
  // 失败那次的变化必须在重试时再次携带。
  expect([...storage.saves[1].changed]).toEqual(['b'])
  expect(storage.committed(PATH)!.contents.get('b')).toBe('方法正文')
})

test('存储层抛出异常也视为失败，不会误标记为 clean', async () => {
  const { storage, session } = setup()
  storage.save = () => Promise.reject(new Error('ipc broken'))
  session.setContent('b', 'x')
  expect(await session.save()).toBe(false)
  expect(session.isDirty).toBe(true)
  expect(session.lastError).toEqual({ code: 'unknown', message: 'Error: ipc broken' })
})

test('保存期间继续编辑：保存成功后仍为 dirty，下一次保存带上新编辑', async () => {
  const { storage, session } = setup()
  session.setContent('a', '第一版')
  storage.hold()
  const first = session.save()
  expect(session.status).toBe('saving')

  session.setContent('a', '第二版')
  storage.release()
  expect(await first).toBe(true)
  expect(session.isDirty).toBe(true)
  expect(storage.committed(PATH)!.contents.get('a')).toBe('第一版')

  await session.save()
  expect(session.isDirty).toBe(false)
  expect(storage.committed(PATH)!.contents.get('a')).toBe('第二版')
})

test('保存串行：进行中的多次保存请求合并为之后的一次', async () => {
  const { storage, session } = setup()
  session.setContent('a', '1')
  storage.hold()
  const first = session.save()
  session.setContent('a', '2')
  const second = session.save()
  const third = session.save()
  expect(second).toBe(third)
  expect(storage.saves.length).toBe(1)

  storage.release()
  expect(await first).toBe(true)
  expect(await second).toBe(true)
  expect(storage.saves.length).toBe(2)
  expect(storage.committed(PATH)!.contents.get('a')).toBe('2')
  expect(session.status).toBe('saved')
})

test('没有修改时保存不访问存储', async () => {
  const { storage, session } = setup()
  expect(await session.save()).toBe(true)
  session.setContent('a', '引言') // 内容相同，不算修改
  expect(await session.save()).toBe(true)
  expect(storage.saves.length).toBe(0)
})

test('修改不存在的章节：返回 false，不变 dirty', () => {
  const { session } = setup()
  expect(session.setContent('ghost', 'x')).toBe(false)
  expect(session.isDirty).toBe(false)
})

test('自动保存：最后一次修改后防抖触发', async () => {
  const { storage, session } = setup({ autosaveDelayMs: 1000 })
  session.setContent('a', '1')
  await vi.advanceTimersByTimeAsync(800)
  session.setContent('a', '12')
  await vi.advanceTimersByTimeAsync(800)
  expect(storage.saves.length).toBe(0)

  await vi.advanceTimersByTimeAsync(200)
  expect(storage.saves.length).toBe(1)
  expect(session.status).toBe('saved')
  expect(storage.committed(PATH)!.contents.get('a')).toBe('12')
})

test('自动保存失败后按重试间隔再次尝试', async () => {
  const { storage, session } = setup({ autosaveDelayMs: 1000, retryDelayMs: 5000 })
  storage.failNext({ code: 'io', operation: 'write', path: 'x', message: 'busy' })
  session.setContent('a', '1')
  await vi.advanceTimersByTimeAsync(1000)
  expect(session.status).toBe('failed')

  await vi.advanceTimersByTimeAsync(4999)
  expect(storage.saves.length).toBe(1)
  await vi.advanceTimersByTimeAsync(1)
  expect(storage.saves.length).toBe(2)
  expect(session.status).toBe('saved')
})

test('关闭自动保存时不会自动写盘', async () => {
  const { storage, session } = setup({ autosaveDelayMs: null })
  session.setContent('a', '1')
  await vi.advanceTimersByTimeAsync(60_000)
  expect(storage.saves.length).toBe(0)
})

test('手动保存取消待触发的自动保存', async () => {
  const { storage, session } = setup({ autosaveDelayMs: 1000 })
  session.setContent('a', '1')
  await session.save()
  await vi.advanceTimersByTimeAsync(5000)
  expect(storage.saves.length).toBe(1)
})

test('close：保存未保存的修改并停止自动保存', async () => {
  const { storage, session } = setup({ autosaveDelayMs: 1000 })
  session.setContent('a', '1')
  expect(await session.close()).toBe(true)
  expect(storage.committed(PATH)!.contents.get('a')).toBe('1')
})

test('close：保存失败时返回 false 且保持 dirty', async () => {
  const { storage, session } = setup()
  session.setContent('a', '1')
  storage.failNext({ code: 'io', operation: 'write', path: 'x', message: 'x' })
  expect(await session.close()).toBe(false)
  expect(session.isDirty).toBe(true)
})

test('close：等待进行中的保存与期间的修改', async () => {
  const { storage, session } = setup()
  session.setContent('a', '1')
  storage.hold()
  void session.save()
  session.setContent('a', '2')
  const closing = session.close()
  storage.release()
  expect(await closing).toBe(true)
  expect(storage.committed(PATH)!.contents.get('a')).toBe('2')
})

test('dispose 后不再自动保存', async () => {
  const { storage, session } = setup({ autosaveDelayMs: 1000 })
  session.setContent('a', '1')
  session.dispose()
  await vi.advanceTimersByTimeAsync(5000)
  expect(storage.saves.length).toBe(0)
})

test('subscribe：修改与保存状态变化都会通知', async () => {
  const { session } = setup()
  const listener = vi.fn()
  const unsubscribe = session.subscribe(listener)
  session.setContent('a', '1')
  expect(listener).toHaveBeenCalledTimes(1)
  await session.save()
  expect(listener.mock.calls.length).toBeGreaterThanOrEqual(3)
  unsubscribe()
  listener.mockClear()
  session.setContent('a', '2')
  expect(listener).not.toHaveBeenCalled()
})

test('openProject：成功得到会话；失败原样返回原因', async () => {
  const storage = new MemoryProjectStorage()
  storage.seed(PATH, initialDocument())
  const opened = await openProject(storage, PATH)
  expect(opened.ok && opened.session.document.title).toBe('论文')

  expect(await openProject(storage, '/不存在')).toEqual({
    ok: false,
    error: { code: 'not-a-project' },
  })
})

test('createProject：新建空文档；目标已存在时失败', async () => {
  const storage = new MemoryProjectStorage()
  const created = await createProject(storage, PATH, '新文档')
  expect(created.ok).toBe(true)
  if (!created.ok) return
  expect(created.session.document.tree).toEqual([])
  expect(created.session.isDirty).toBe(false)

  expect(await createProject(storage, PATH, '新文档')).toEqual({
    ok: false,
    error: { code: 'target-not-empty' },
  })
})

test('releaseSession：保存成功直接释放，不询问', async () => {
  const { storage, session } = setup()
  session.setContent('a', '1')
  const confirm = vi.fn(async () => false)
  expect(await releaseSession(session, confirm)).toBe(true)
  expect(confirm).not.toHaveBeenCalled()
  expect(storage.committed(PATH)!.contents.get('a')).toBe('1')
})

test('releaseSession：保存失败时询问；用户拒绝丢弃则会话保留且仍可保存', async () => {
  const { storage, session } = setup({ autosaveDelayMs: 1000 })
  session.setContent('a', '1')
  storage.failNext({ code: 'io', operation: 'write', path: 'x', message: 'x' })
  const confirm = vi.fn(async () => false)
  expect(await releaseSession(session, confirm)).toBe(false)
  expect(confirm).toHaveBeenCalledWith({ code: 'io', operation: 'write', path: 'x', message: 'x' })
  expect(session.isDirty).toBe(true)
  expect(await session.save()).toBe(true)
})

test('releaseSession：保存失败且用户确认丢弃 → 释放', async () => {
  const { storage, session } = setup()
  session.setContent('a', '1')
  storage.failNext({ code: 'io', operation: 'write', path: 'x', message: 'x' })
  expect(await releaseSession(session, async () => true)).toBe(true)
  expect(storage.committed(PATH)!.contents.get('a')).toBe('引言')
})
