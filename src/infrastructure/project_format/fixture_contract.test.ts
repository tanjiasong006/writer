import { expect, test } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { createDocument } from '../../domain/document/document.ts'
import { buildManifest, parseManifest } from './project_format.ts'

/**
 * 与 Rust 共享的格式契约：src-tauri/fixtures/示例项目 同时被 Rust storage 测试读取。
 * 这里验证 TS 能解析它，并且由同一文档生成的 manifest 与它逐字段一致。
 */
const root = fileURLToPath(new URL('../../../src-tauri/fixtures/示例项目/', import.meta.url))

test('共享示例项目：TS 解析与生成都与磁盘格式一致', () => {
  const raw = JSON.parse(readFileSync(`${root}writer.json`, 'utf8'))
  const parsed = parseManifest(raw)
  expect(parsed.ok).toBe(true)
  if (!parsed.ok) return

  const contents = new Map(
    [...parsed.manifest.files].map(([id, file]) => [id, readFileSync(`${root}content/${file}`, 'utf8')]),
  )
  const document = createDocument(parsed.manifest.title, parsed.manifest.tree, contents)
  expect(document.ok).toBe(true)
  if (!document.ok) return

  expect(JSON.parse(JSON.stringify(buildManifest(document.document)))).toEqual(raw)
  expect(document.document.contents.get('3f1c9a52-0000-4000-8000-000000000003')).toContain('\r\n')
})
