import { expect, test } from 'vitest'
import {
  citationAddress,
  citationNumbers,
  emptyReference,
  formatReference,
  newReferenceId,
  parseCitationAddress,
  serializeReference,
  validateReferences,
  type ReferenceEntry,
} from './bibliography.ts'

function entry(fields: Partial<ReferenceEntry>): ReferenceEntry {
  return { ...emptyReference('x'), ...fields }
}

test('著录格式：专著、期刊、析出文献、学位论文、电子资源', () => {
  expect(formatReference(entry({ type: 'book', author: '张三；李四', title: '长文档写作', place: '北京', publisher: '某出版社', year: '2020', pages: '12-20' })))
    .toBe('张三, 李四. 长文档写作[M]. 北京: 某出版社, 2020: 12-20.')
  expect(formatReference(entry({ type: 'article', author: '王五', title: '结构化写作', container: '编辑学报', year: '2021', volume: '33', issue: '2', pages: '5-9' })))
    .toBe('王五. 结构化写作[J]. 编辑学报, 2021, 33(2): 5-9.')
  expect(formatReference(entry({ type: 'chapter', author: '赵六', title: '章节组织', container: '写作手册', place: '上海', publisher: '某社', year: '2019', pages: '30-41' })))
    .toBe('赵六. 章节组织[M]//写作手册. 上海: 某社, 2019: 30-41.')
  expect(formatReference(entry({ type: 'thesis', author: '钱七', title: '论文题目', place: '北京', publisher: '某大学', year: '2018' })))
    .toBe('钱七. 论文题目[D]. 北京: 某大学, 2018.')
  expect(formatReference(entry({ type: 'web', author: 'Writer Team', title: 'Writer', container: 'Writer', year: '2026', url: 'https://example.com' })))
    .toBe('Writer Team. Writer[EB/OL]. Writer (2026). https://example.com.')
})

test('作者超过 3 位时加“等”或 et al；缺少的项省略；有 DOI 时写 DOI', () => {
  expect(formatReference(entry({ author: '甲;乙;丙;丁', title: '书' }))).toBe('甲, 乙, 丙, 等. 书[M].')
  expect(formatReference(entry({ author: 'A;B;C;D', title: 'Book', year: '2000' }))).toBe('A, B, C, et al. Book[M]. 2000.')
  expect(formatReference(entry({ type: 'article', title: '文', container: '刊', doi: '10.1/x' }))).toBe('文[J]. 刊. DOI: 10.1/x.')
  expect(formatReference(entry({}))).toBe('（无题名）[M].')
})

test('引用按首次出现编号，重复引用同一编号，不存在的条目不编号', () => {
  const entries = [emptyReference('a'), emptyReference('b')]
  const numbers = citationNumbers(['writer:cite/b', 'writer:cite/x', 'writer:cite/a', 'writer:cite/b', 'https://e.com'], entries)
  expect([...numbers]).toEqual([['b', 1], ['a', 2]])
  expect(parseCitationAddress(citationAddress('a1'))).toBe('a1')
  expect(parseCitationAddress('writer:cite/a b')).toBeNull()
})

test('校验与写出：只写非空字段；标识重复、类型未知、字段不是字符串时拒绝', () => {
  const stored = serializeReference({ ...emptyReference('a', 'article'), title: ' 题名 ' })
  expect(stored).toEqual({ id: 'a', type: 'article', title: '题名' })
  expect(validateReferences([stored])).toEqual([{ ...emptyReference('a', 'article'), title: '题名' }])
  expect(validateReferences([{ id: 'a', type: 'book' }, { id: 'a', type: 'book' }])).toBeNull()
  expect(validateReferences([{ id: 'a', type: 'novel' }])).toBeNull()
  expect(validateReferences([{ id: 'a', type: 'book', title: 1 }])).toBeNull()
  expect(validateReferences('x')).toBeNull()
  expect(newReferenceId([emptyReference('aaaaaaaa')], () => 0.99)).toMatch(/^[a-z0-9]{8}$/)
})
