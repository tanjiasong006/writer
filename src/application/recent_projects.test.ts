import { expect, test } from 'vitest'
import { MemoryShell } from '../testing/memory_services.ts'
import { clearRecentProjects, forgetRecentProject, projectName, recentProjects, rememberRecentProject } from './recent_projects.ts'

test('最近的在前，同一路径只出现一次，最多 10 个；可以去掉与清除', () => {
  const shell = new MemoryShell()
  expect(recentProjects(shell)).toEqual([])
  for (let i = 0; i < 12; i++) rememberRecentProject(shell, `/p/${i}`)
  rememberRecentProject(shell, '/p/5')
  const list = recentProjects(shell)
  expect(list).toHaveLength(10)
  expect(list.slice(0, 3)).toEqual(['/p/5', '/p/11', '/p/10'])
  expect(forgetRecentProject(shell, '/p/11').slice(0, 2)).toEqual(['/p/5', '/p/10'])
  expect(clearRecentProjects(shell)).toEqual([])
  expect(recentProjects(shell)).toEqual([])
})

test('偏好损坏时当作没有记录；名称是文件夹名', () => {
  const shell = new MemoryShell()
  shell.setPreference('recentProjects', '{bad')
  expect(recentProjects(shell)).toEqual([])
  expect(projectName('/文稿/毕业论文/')).toBe('毕业论文')
  expect(projectName('C:\\Docs\\报告')).toBe('报告')
})
