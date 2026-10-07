import { expect, test } from 'vitest'
import { formatLogArgs } from './tauri_log.ts'

test('strings are written as they are, other values as JSON', () => {
  expect(formatLogArgs(['[x] failed', { step: 'decode', width: 10 }, 3, null])).toBe('[x] failed {"step":"decode","width":10} 3 null')
})

test('errors keep their name, message and stack, also inside objects', () => {
  const error = new TypeError('bad image')
  expect(formatLogArgs([error])).toContain('TypeError: bad image')
  const nested = formatLogArgs([{ step: 'png', error }])
  expect(nested).toContain('"step":"png"')
  expect(nested).toContain('TypeError: bad image')
})

test('DOMException is described like an error', () => {
  expect(formatLogArgs([new DOMException('The source image cannot be decoded.', 'EncodingError')])).toContain(
    'EncodingError: The source image cannot be decoded.',
  )
})

test('values that cannot be written as JSON fall back to String', () => {
  const cyclic: Record<string, unknown> = {}
  cyclic.self = cyclic
  expect(formatLogArgs([cyclic])).toBe('[object Object]')
  expect(formatLogArgs([undefined])).toBe('undefined')
})
