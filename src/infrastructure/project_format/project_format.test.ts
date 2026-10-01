import { test } from 'vitest'
import assert from 'node:assert/strict'
import type { ChapterTree } from '../../domain/chapter_tree/chapter_tree.ts'
import { MAX_CHAPTER_DEPTH } from '../../domain/chapter_tree/chapter_tree.ts'
import { replaceTree, emptyDocument, setDocumentInfo } from '../../domain/document/document.ts'
import {
  buildManifest,
  contentFileName,
  contentFiles,
  isContentFileName,
  parseManifest,
  resolveAssetReference,
  type ManifestIssue,
} from './project_format.ts'

const tree: ChapterTree = [
  { id: 'a', title: '绪论', children: [] },
  {
    id: 'b',
    title: '方法',
    children: [
      { id: 'b1', title: '实验设计', children: [{ id: 'b11', title: '样本', children: [] }] },
      { id: 'b2', title: '数据', children: [] },
    ],
  },
]

function manifestJson(overrides: Record<string, unknown> = {}): unknown {
  // 经过一次 JSON 往返，模拟真实从磁盘读到的数据。
  const manifest = buildManifest(replaceTree(emptyDocument('我的论文'), tree))
  return { ...JSON.parse(JSON.stringify(manifest)), ...overrides }
}

function issueOf(raw: unknown): ManifestIssue {
  const result = parseManifest(raw)
  assert.equal(result.ok, false)
  if (result.ok) throw new Error('unreachable')
  return result.issue
}

test('contentFileName：编号以下划线连接', () => {
  assert.equal(contentFileName([1]), 'ch_1.md')
  assert.equal(contentFileName([2, 1]), 'ch_2_1.md')
  assert.equal(contentFileName([4, 1, 13]), 'ch_4_1_13.md')
})

test('isContentFileName：只接受规范格式，拒绝路径与前导 0', () => {
  for (const name of ['ch_1.md', 'ch_2_1.md', 'ch_10_20_3.md']) assert.equal(isContentFileName(name), true, name)
  for (const name of [
    'ch_.md',
    'ch_0.md',
    'ch_01.md',
    'ch_1_.md',
    'ch_1.MD',
    '../ch_1.md',
    'sub/ch_1.md',
    'ch_1.md\u0000',
    'ch_1.md ',
    'ch_一.md',
  ]) {
    assert.equal(isContentFileName(name), false, JSON.stringify(name))
  }
})

test('contentFiles：按章节编号推导文件名', () => {
  assert.deepEqual(
    [...contentFiles(tree)],
    [
      ['a', 'ch_1.md'],
      ['b', 'ch_2.md'],
      ['b1', 'ch_2_1.md'],
      ['b11', 'ch_2_1_1.md'],
      ['b2', 'ch_2_2.md'],
    ],
  )
})

test('contentFiles：章节移动后 id 不变、文件名跟随新编号', () => {
  const moved: ChapterTree = [tree[1], tree[0]]
  const files = contentFiles(moved)
  assert.equal(files.get('a'), 'ch_2.md')
  assert.equal(files.get('b'), 'ch_1.md')
  assert.equal(files.get('b11'), 'ch_1_1_1.md')
})

test('buildManifest：包含格式、版本、标题、章节树和文件对应关系', () => {
  const manifest = buildManifest(replaceTree(emptyDocument('我的论文'), tree))
  assert.equal(manifest.format, 'writer-project')
  assert.equal(manifest.version, 1)
  assert.equal(manifest.title, '我的论文')
  assert.equal(manifest.chapters, tree)
  assert.equal(manifest.files.b2, 'ch_2_2.md')
})

test('文档信息：副标题与作者非空时写出并往返；空串时不写出', () => {
  const plain = buildManifest(emptyDocument('论文'))
  assert.equal('subtitle' in plain, false)
  assert.equal('author' in plain, false)

  const document = setDocumentInfo(emptyDocument('论文'), { title: '论文', subtitle: '一项研究', author: '张三' })
  const raw = JSON.parse(JSON.stringify(buildManifest(document)))
  assert.equal(raw.subtitle, '一项研究')
  assert.equal(raw.author, '张三')
  const result = parseManifest(raw)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.manifest.info, { title: '论文', subtitle: '一项研究', author: '张三' })
})

test('文档信息：副标题或作者不是字符串时拒绝打开', () => {
  assert.equal(issueOf(manifestJson({ subtitle: 3 })).code, 'subtitle-invalid')
  assert.equal(issueOf(manifestJson({ subtitle: null })).code, 'subtitle-invalid')
  assert.equal(issueOf(manifestJson({ author: ['张三'] })).code, 'author-invalid')
})

test('PDF 排版配置：没有改动时不写出；只写出合法的项，按固定顺序', () => {
  assert.equal('pdf' in buildManifest(emptyDocument('论文')), false)
  assert.equal('pdf' in buildManifest(emptyDocument('论文'), {}), false)
  const manifest = buildManifest(emptyDocument('论文'), { table: 'grid', paper: 'b5' })
  assert.equal(JSON.stringify(manifest.pdf), '{"paper":"b5","table":"grid"}')
})

test('PDF 排版配置：有问题不阻止打开，只忽略有问题的部分', () => {
  const layoutOf = (pdf: unknown) => {
    const result = parseManifest(manifestJson({ pdf }))
    assert.equal(result.ok, true)
    return result.ok ? result.manifest.pdfLayout : null
  }
  assert.deepEqual(layoutOf(undefined), {})
  assert.deepEqual(layoutOf('a4'), {})
  assert.deepEqual(layoutOf(['a4']), {})
  assert.deepEqual(layoutOf(null), {})
  assert.deepEqual(
    layoutOf({ paper: 'b5', margin: 'huge', bodySize: '12', toc: 'no', tocDepth: 3, future: 1 }),
    { paper: 'b5', tocDepth: 3 },
  )
})

test('buildManifest：空文档', () => {
  const manifest = buildManifest(emptyDocument(''))
  assert.deepEqual(manifest.chapters, [])
  assert.deepEqual(manifest.files, {})
})

test('parseManifest：生成的 manifest 往返后解析成功', () => {
  const result = parseManifest(manifestJson())
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.deepEqual(result.manifest.info, { title: '我的论文', subtitle: '', author: '' })
  assert.deepEqual(result.manifest.tree, tree)
  assert.equal(result.manifest.files.get('b1'), 'ch_2_1.md')
})

test('parseManifest：文件名不必等于按编号推导的名字', () => {
  const raw = manifestJson()
  const files = { ...(raw as { files: Record<string, string> }).files, a: 'ch_9.md' }
  const result = parseManifest({ ...(raw as object), files })
  assert.equal(result.ok && result.manifest.files.get('a'), 'ch_9.md')
})

test('parseManifest：顶层结构错误', () => {
  assert.equal(issueOf(null).code, 'not-an-object')
  assert.equal(issueOf([]).code, 'not-an-object')
  assert.equal(issueOf('x').code, 'not-an-object')
  assert.equal(issueOf(manifestJson({ format: 'other' })).code, 'format-unknown')
  assert.deepEqual(issueOf(manifestJson({ version: 2 })), { code: 'version-unsupported', version: 2 })
  assert.equal(issueOf(manifestJson({ version: '1' })).code, 'version-unsupported')
  assert.equal(issueOf(manifestJson({ title: 3 })).code, 'title-invalid')
})

test('parseManifest：章节树不合法', () => {
  const issue = issueOf(manifestJson({ chapters: [{ id: '', title: 'x', children: [] }] }))
  assert.equal(issue.code, 'tree-invalid')
  assert.equal(issue.code === 'tree-invalid' && issue.issues[0].code, 'id-invalid')
})

test('parseManifest：章节树超过层级上限被拒绝', () => {
  let node = { id: 'n0', title: '', children: [] as unknown[] }
  const root = node
  for (let i = 1; i <= MAX_CHAPTER_DEPTH; i++) {
    const child = { id: `n${i}`, title: '', children: [] as unknown[] }
    node.children.push(child)
    node = child
  }
  const issue = issueOf(manifestJson({ chapters: [root], files: {} }))
  assert.equal(issue.code === 'tree-invalid' && issue.issues[0].code, 'depth-exceeded')
})

test('parseManifest：files 结构与一致性', () => {
  const files = (manifestJson() as { files: Record<string, string> }).files
  assert.equal(issueOf(manifestJson({ files: [] })).code, 'files-invalid')
  assert.equal(issueOf(manifestJson({ files: null })).code, 'files-invalid')
  assert.deepEqual(issueOf(manifestJson({ files: { ...files, a: '../evil.md' } })), {
    code: 'file-name-invalid',
    chapterId: 'a',
  })
  assert.deepEqual(issueOf(manifestJson({ files: { ...files, a: 7 } })), {
    code: 'file-name-invalid',
    chapterId: 'a',
  })
  assert.deepEqual(issueOf(manifestJson({ files: { ...files, b: 'ch_1.md' } })), {
    code: 'file-duplicate',
    chapterId: 'b',
  })
  const { b2: _removed, ...missing } = files
  assert.deepEqual(issueOf(manifestJson({ files: missing })), { code: 'file-missing', chapterId: 'b2' })
  assert.deepEqual(issueOf(manifestJson({ files: { ...files, ghost: 'ch_7.md' } })), {
    code: 'file-orphan',
    chapterId: 'ghost',
  })
})

test('parseManifest：中文标题与特殊 id 原样保留', () => {
  const special: ChapterTree = [{ id: '__proto__', title: '第一章：「引言」', children: [] }]
  const raw = JSON.parse(JSON.stringify(buildManifest(replaceTree(emptyDocument('论文 🎓'), special))))
  const result = parseManifest(raw)
  assert.equal(result.ok, true)
  if (!result.ok) return
  assert.equal(result.manifest.info.title, '论文 🎓')
  assert.equal(result.manifest.files.get('__proto__'), 'ch_1.md')
})

test('resolveAssetReference：正文中的资源引用解析为项目内路径', () => {
  assert.equal(resolveAssetReference('/文稿/论文', '../assets/实验 图.png'), '/文稿/论文/assets/实验 图.png')
  assert.equal(
    resolveAssetReference('/文稿/论文/', '../assets/%E5%AE%9E%E9%AA%8C%20%E5%9B%BE.png'),
    '/文稿/论文/assets/实验 图.png',
  )
  assert.equal(resolveAssetReference('/文稿/论文', './图.png'), '/文稿/论文/content/图.png')
  assert.equal(resolveAssetReference('/文稿/论文', '图.png'), '/文稿/论文/content/图.png')
  assert.equal(resolveAssetReference('/文稿/论文', '../assets/./sub/../a.png'), '/文稿/论文/assets/a.png')
  assert.equal(resolveAssetReference('/文稿/论文', '..\\assets\\a.png'), '/文稿/论文/assets/a.png')
  assert.equal(resolveAssetReference('/文稿/论文', '../assets//a.png'), '/文稿/论文/assets/a.png')
  assert.equal(resolveAssetReference('C:\\文稿\\论文', '../assets/a.png'), 'C:\\文稿\\论文\\assets\\a.png')
})

test('resolveAssetReference：项目外、远程、绝对路径与非法编码返回 null', () => {
  for (const reference of [
    '../../secret.png',
    '../assets/../../x.png',
    '/etc/hosts',
    'C:/Windows/a.png',
    '\\\\server\\a.png',
    'https://example.com/a.png',
    'data:image/png;base64,AAAA',
    '../assets/%E5%',
    '../assets/%ZZ.png',
    '..',
    '',
  ]) {
    assert.equal(resolveAssetReference('/文稿/论文', reference), null, reference)
  }
})

test('旧项目的 style（已取消的文档样式）：无论内容如何都忽略，不拒绝打开；生成的 manifest 不含 style', () => {
  for (const style of [
    { theme: 'technical', overrides: { bodySize: 12 }, images: { 'assets/a.png': { size: 'large' } } },
    { theme: 'future-theme', overrides: { bodySize: 999 }, images: { '../outside.png': 'huge' } },
    null,
    3,
    'book',
    [],
  ]) {
    const parsed = parseManifest(manifestJson({ style }))
    assert.ok(parsed.ok, JSON.stringify(style))
    if (!parsed.ok) return
    assert.deepEqual(Object.keys(parsed.manifest).sort(), ['files', 'info', 'pdfLayout', 'tree'])
  }
  const document = replaceTree(emptyDocument('我的论文'), tree)
  assert.equal('style' in buildManifest(document), false)
})
