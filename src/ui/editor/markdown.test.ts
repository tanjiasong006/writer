import { describe, expect, test } from 'vitest'
import { DOMParser as PMDOMParser, type Node } from 'prosemirror-model'
import { EditorState } from 'prosemirror-state'
import { appendImage, parseChapter, parseMarkdown, serializeChapter } from './markdown.ts'
import { marks, nodes, schema } from './schema.ts'

const { doc, paragraph: p, blockquote, code_block, bullet_list, ordered_list, list_item } = nodes
const { table, table_row, table_header, table_cell, image, figure, hard_break, horizontal_rule } = nodes

function text(value: string, ...markNames: Array<keyof typeof marks>) {
  return schema.text(value, markNames.map((name) => marks[name].create()))
}

function write(node: Node): string {
  return serializeChapter(node)
}

/** 解析 → 序列化 → 再解析，结构不变；再序列化结果也不变。 */
function expectRoundTrip(markdown: string): void {
  const first = parseMarkdown(markdown)
  const written = write(first)
  const second = parseMarkdown(written)
  expect(second.toJSON()).toEqual(first.toJSON())
  expect(write(second)).toBe(written)
}

/** 编辑器中构造的文档：序列化后再解析得到同一结构。 */
function expectStable(node: Node): string {
  const written = write(node)
  expect(parseMarkdown(written).toJSON()).toEqual(node.toJSON())
  return written
}

describe('Markdown → 文档', () => {
  test('段落、粗体、斜体、删除线、行内代码、链接', () => {
    const parsed = parseMarkdown('普通**粗体***斜体*~~删除~~`代码`[链接](https://a.com "标题")')
    expect(parsed.toJSON()).toEqual(
      doc
        .create(null, [
          p.create(null, [
            text('普通'),
            text('粗体', 'strong'),
            text('斜体', 'em'),
            text('删除', 'strike'),
            text('代码', 'code'),
            schema.text('链接', [marks.link.create({ href: 'https://a.com', title: '标题' })]),
          ]),
        ])
        .toJSON(),
    )
  })

  test('空行分隔段落；多个空行与单个空行相同', () => {
    expect(parseMarkdown('一\n\n\n\n二').toJSON()).toEqual(
      doc.create(null, [p.create(null, text('一')), p.create(null, text('二'))]).toJSON(),
    )
  })

  test('软换行：中文之间去掉，其他情况变成空格（与导出一致）', () => {
    expect(parseMarkdown('第一行\n第二行\nEnglish\nline').textContent).toBe('第一行第二行 English line')
  })

  test('嵌套列表、有序列表起始编号、紧凑与松散', () => {
    const parsed = parseMarkdown('- a\n  - b\n- c\n\n3. x\n\n4. y\n')
    const [bullets, ordered] = [parsed.child(0), parsed.child(1)]
    expect(bullets.type).toBe(bullet_list)
    expect(bullets.attrs.tight).toBe(true)
    expect(bullets.child(0).child(1).type).toBe(bullet_list)
    expect(ordered.type).toBe(ordered_list)
    expect(ordered.attrs).toEqual({ order: 3, tight: false, numbering: '1.' })
  })

  test('任务列表标记进入列表项属性；转义的方括号不是任务标记', () => {
    const parsed = parseMarkdown('- [ ] 待办\n- [x] 完成\n- \\[ ] 普通\n')
    const list = parsed.child(0)
    expect([0, 1, 2].map((i) => list.child(i).attrs.checked)).toEqual([false, true, null])
    expect(list.child(0).textContent).toBe('待办')
    expect(list.child(2).textContent).toBe('[ ] 普通')
  })

  test('代码块保留语言与内容；缩进代码块也是代码块', () => {
    const fenced = parseMarkdown('```python\nprint(1)\n\n  x\n```').child(0)
    expect(fenced.type).toBe(code_block)
    expect(fenced.attrs.params).toBe('python')
    expect(fenced.textContent).toBe('print(1)\n\n  x')
    expect(parseMarkdown('    缩进代码').child(0).type).toBe(code_block)
  })

  test('表格：表头、对齐、单元格中的行内格式与图片', () => {
    const parsed = parseMarkdown('| 组别 | 样本数 |\n| :-- | --: |\n| **对照** | ![i](i.png) |\n')
    const t = parsed.child(0)
    expect(t.type).toBe(table)
    expect(t.child(0).child(0).type).toBe(table_header)
    expect(t.child(0).child(0).attrs.align).toBe('left')
    expect(t.child(0).child(1).attrs.align).toBe('right')
    expect(t.child(1).child(0).type).toBe(table_cell)
    expect(t.child(1).child(0).firstChild!.marks[0].type).toBe(marks.strong)
    expect(t.child(1).child(1).firstChild!.type).toBe(image)
  })

  test('图片保留原始引用（不做百分号编码），alt 合并全部文字', () => {
    const img = parseMarkdown('![实验*装置*](../assets/实验装置.png "说明")').child(0)
    expect(img.type).toBe(figure)
    expect(img.attrs).toEqual({ src: '../assets/实验装置.png', alt: '实验装置', title: '说明' })
  })

  test('独占一段的图片解析为块级的 figure；与文字同处一段的图片仍是段落中的行内图片，文字不丢失', () => {
    const parsed = parseMarkdown(
      '![图一](../assets/1.png)\n\n说明文字 ![图二](../assets/2.png) 之后\n\n![a](a.png)\n![b](b.png)\n\n> ![引用中](q.png)\n\n- ![列表中](l.png)\n- [ ] ![任务](t.png)\n\n| ![单元格](c.png) |\n| - |\n',
    )
    const types = Array.from({ length: parsed.childCount }, (_, i) => parsed.child(i).type)
    expect(types).toEqual([figure, p, p, blockquote, bullet_list, table])
    expect(parsed.child(1).textContent).toBe('说明文字  之后')
    expect(parsed.child(1).child(1).type).toBe(image)
    expect(parsed.child(2).childCount).toBe(3)
    expect(parsed.child(3).firstChild!.type).toBe(figure)
    expect(parsed.child(4).child(0).firstChild!.type).toBe(figure)
    expect(parsed.child(4).child(1).attrs.checked).toBe(false)
    expect(parsed.child(4).child(1).firstChild!.type).toBe(figure)
    expect(parsed.child(5).firstChild!.firstChild!.firstChild!.type).toBe(image)
  })

  test('figure 写回的 Markdown 与只含这张图片的段落完全相同，没有新语法', () => {
    const source = '![图一](../assets/1.png "标题")\n\n> ![引用中](q.png)\n\n- ![列表中](l.png)\n- [ ] ![任务](t.png)\n'
    expect(write(parseMarkdown(source))).toBe(source)
    const attrs = { src: '../assets/实验 图.png', alt: '图[1]', title: null }
    expect(write(doc.create(null, figure.create(attrs)))).toBe(write(doc.create(null, p.create(null, image.create(attrs)))))
  })

  test('原始 HTML 是文字（与 Rust 渲染器一致），不会成为结构', () => {
    const parsed = parseMarkdown('<div>块</div>\n\n行内 <b>粗</b>')
    expect(parsed.textContent).toBe('<div>块</div>行内 <b>粗</b>')
    expect(parsed.child(1).child(0).marks).toEqual([])
  })

  test('正文不支持标题：Markdown 标题是原文文字的段落，强调记号也是文字；写回时转义', () => {
    const parsed = parseMarkdown('## 二级 **强调** 标题 ##\n段落\n# 打断\n\n标题\n===')
    expect(parsed.childCount).toBe(4)
    parsed.forEach((node) => expect(node.type).toBe(p))
    expect(parsed.child(0).textContent).toBe('## 二级 **强调** 标题')
    expect(parsed.child(0).child(0).marks).toEqual([])
    expect(parsed.child(2).textContent).toBe('# 打断')
    expect(parsed.child(3).textContent).toBe('标题 ===')
    const written = write(parsed)
    expect(written).toBe('\\## 二级 \\*\\*强调\\*\\* 标题\n\n段落\n\n\\# 打断\n\n标题 ===\n')
    expect(parseMarkdown(written).toJSON()).toEqual(parsed.toJSON())
  })

  test('引用、分隔线、硬换行', () => {
    const parsed = parseMarkdown('> 引用\n\n---\n\n甲  \n乙\\\n丙')
    expect(parsed.child(0).type).toBe(blockquote)
    expect(parsed.child(1).type).toBe(horizontal_rule)
    const breaks: string[] = []
    parsed.child(2).forEach((child) => breaks.push(child.type.name))
    expect(breaks).toEqual(['text', 'hard_break', 'text', 'hard_break', 'text'])
  })

  test('空正文与只有空白的正文得到一个空段落', () => {
    for (const empty of ['', '\n\n', '   \n']) {
      const parsed = parseMarkdown(empty)
      expect(parsed.childCount).toBe(1)
      expect(parsed.child(0).type).toBe(p)
      expect(parsed.child(0).content.size).toBe(0)
    }
  })
})

describe('文档 → Markdown', () => {
  test('常用结构的写法', () => {
    const written = write(
      doc.create(null, [
        p.create(null, [text('本节介绍'), text('实验设计', 'strong'), text('与'), text('变量控制', 'em'), text('。')]),
        bullet_list.create(null, [list_item.create(null, p.create(null, text('对照组'))), list_item.create(null, p.create(null, text('实验组')))]),
        blockquote.create(null, p.create(null, text('所有数据均经过脱敏处理。'))),
        code_block.create({ params: 'python' }, text('print("hello")')),
      ]),
    )
    expect(written).toBe(
      [
        '本节介绍**实验设计**与*变量控制*。',
        '',
        '- 对照组',
        '- 实验组',
        '',
        '> 所有数据均经过脱敏处理。',
        '',
        '```python',
        'print("hello")',
        '```',
        '',
      ].join('\n'),
    )
  })

  test('表格：列对齐、竖线转义', () => {
    const cell = (type: typeof table_cell, content: string, attrs: Record<string, unknown> = {}) =>
      type.create(attrs, content ? text(content) : null)
    const written = write(
      doc.create(
        null,
        table.create(null, [
          table_row.create(null, [cell(table_header, '名称', { align: 'center' }), cell(table_header, '值', { align: 'right' }), cell(table_header, '备注')]),
          table_row.create(null, [cell(table_cell, 'a|b', { align: 'center' }), cell(table_cell, '', { align: 'right' }), cell(table_cell, '')]),
        ]),
      ),
    )
    expect(written).toBe('| 名称 | 值 | 备注 |\n| :---: | ---: | --- |\n| a\\|b |  |  |\n')
    const reparsed = parseMarkdown(written).child(0)
    expect(reparsed.child(1).child(0).textContent).toBe('a|b')
    expect(reparsed.child(1).childCount).toBe(3)
  })

  describe('合并单元格（docs/decisions.md 第 23 节）', () => {
    const cell = (type: typeof table_cell, content: string, attrs: Record<string, unknown> = {}) =>
      type.create(attrs, content ? text(content) : null)
    /** 表格各行的单元格：文字与非 1 的跨行 / 跨列。 */
    const cells = (table: ReturnType<typeof parseMarkdown>) => {
      const rows: string[][] = []
      table.forEach((row) => {
        const out: string[] = []
        row.forEach((c) => {
          const span = [c.attrs.colspan !== 1 ? `c${c.attrs.colspan}` : '', c.attrs.rowspan !== 1 ? `r${c.attrs.rowspan}` : '']
          out.push([c.textContent, ...span.filter(Boolean)].join(' '))
        })
        rows.push(out)
      })
      return rows
    }

    test('表头横向合并，正文纵向、横向与二维合并；写出后再解析不变', () => {
      const markdown = [
        '| 地区 | 2024 || 备注 |',
        '| --- | ---: | ---: | --- |',
        '| 华东 | 1 | 2 | 甲 |',
        '| ^^ | 3 || 乙 |',
        '| ^^ | ^^ || 丙 |',
        '',
      ].join('\n')
      const parsed = parseMarkdown(markdown)
      expect(cells(parsed.child(0))).toEqual([
        ['地区', '2024 c2', '备注'],
        ['华东 r3', '1', '2', '甲'],
        ['3 c2 r2', '乙'],
        ['丙'],
      ])
      expect(write(parsed)).toBe(markdown)
    })

    test('有空白的空单元格、补齐的单元格、转义的 \\^^、正文第一行的 ^^ 不合并', () => {
      expect(cells(parseMarkdown('| a |  | b |\n|---|---|---|\n| 1 |').child(0))).toEqual([['a', '', 'b'], ['1', '', '']])
      expect(cells(parseMarkdown('| a |\n|---|\n| ^^ |\n| \\^^ |').child(0))).toEqual([['a'], ['^^'], ['^^']])
      // 正文第一行的 ^^ 是文字，第二行的 ^^ 与它合并。
      expect(cells(parseMarkdown('| a |\n|---|\n| ^^ |\n| ^^ |').child(0))).toEqual([['a'], ['^^ r2'], []])
      expect(cells(parseMarkdown('| a |\n|---|\n| 1 |\n| \\^^ |').child(0))).toEqual([['a'], ['1'], ['^^']])
      expect(cells(parseMarkdown('> | a || b |\n> |---|---|---|').child(0).child(0))).toEqual([['a c2', 'b']])
    })

    test('紧跟在一行文字之后的表格仍是表格（与 pulldown-cmark 相同，表格可以打断段落）', () => {
      const parsed = parseMarkdown('文字\n| a |\n| --- |\n| 1 |\n')
      expect(parsed.childCount).toBe(2)
      expect(parsed.child(1).type).toBe(table)
    })

    test('内容恰好是 ^^ 的单元格写出时转义', () => {
      const written = write(
        doc.create(null, table.create(null, [table_row.create(null, [cell(table_header, 'a')]), table_row.create(null, [cell(table_cell, '^^')])])),
      )
      expect(written).toBe('| a |\n| --- |\n| \\^^ |\n')
    })

    test('表头不与正文合并：从表头向下合并的部分写成空单元格', () => {
      const written = write(
        doc.create(
          null,
          table.create(null, [
            table_row.create(null, [cell(table_header, 'a', { rowspan: 2 }), cell(table_header, 'b')]),
            table_row.create(null, [cell(table_cell, '1')]),
          ]),
        ),
      )
      expect(written).toBe('| a | b |\n| --- | --- |\n|  | 1 |\n')
    })

    test('列对齐取这一列中第一个从这一列开始的单元格', () => {
      const written = write(
        doc.create(
          null,
          table.create(null, [
            table_row.create(null, [cell(table_header, 'a', { colspan: 2, align: 'center' })]),
            table_row.create(null, [cell(table_cell, '1', { align: 'center' }), cell(table_cell, '2', { align: 'right' })]),
          ]),
        ),
      )
      expect(written).toBe('| a ||\n| :---: | ---: |\n| 1 | 2 |\n')
    })
  })

  test('图片：含空格的引用用尖括号包裹，括号转义', () => {
    const one = (src: string) => write(doc.create(null, figure.create({ src, alt: '图' })))
    expect(one('../assets/实验 图.png')).toBe('![图](<../assets/实验 图.png>)\n')
    expect(one('../assets/a(1).png')).toBe('![图](../assets/a\\(1\\).png)\n')
    for (const src of ['../assets/实验 图.png', '../assets/a(1).png', '../assets/%E5%9B%BE.png']) {
      expect(parseMarkdown(one(src)).child(0).attrs.src).toBe(src)
    }
  })

  test('相邻的同类列表换用另一种标记，再次解析不会合并', () => {
    const list = (type: typeof bullet_list, value: string) =>
      type.create(null, list_item.create(null, p.create(null, text(value))))
    const node = doc.create(null, [list(bullet_list, '一'), list(bullet_list, '二'), list(ordered_list, '三'), list(ordered_list, '四')])
    expect(expectStable(node)).toBe('- 一\n\n\n* 二\n\n1. 三\n\n\n1) 四\n')
  })

  test('编号样式：写在列表之前一行，默认样式不写出', () => {
    const item = (value: string, ...rest: Node[]) => list_item.create(null, [p.create(null, text(value)), ...rest])
    const nested = ordered_list.create({ numbering: 'a.' }, [item('子')])
    const node = doc.create(null, [
      p.create(null, text('前文')),
      ordered_list.create({ numbering: '（一）', order: 2 }, [item('甲', nested), item('乙')]),
      ordered_list.create(null, [item('丙')]),
      blockquote.create(null, ordered_list.create({ numbering: 'I.' }, [item('丁')])),
    ])
    expect(expectStable(node)).toBe(
      '前文\n\n<!-- writer:list （一） -->\n2. 甲\n   <!-- writer:list a. -->\n   1. 子\n3. 乙\n\n\n1) 丙\n\n> <!-- writer:list I. -->\n> 1. 丁\n',
    )
  })

  test('编号样式注释可以打断段落，也可以在列表项开头；不紧挨有序列表时是文字', () => {
    const numbering = (markdown: string) => {
      const found: string[] = []
      parseMarkdown(markdown).descendants((node) => {
        if (node.type === ordered_list) found.push(node.attrs.numbering as string)
      })
      return found
    }
    expect(numbering('段落\n<!-- writer:list ① -->\n3. 甲')).toEqual(['①'])
    expect(parseMarkdown('段落\n<!-- writer:list ① -->\n3. 甲').child(0).textContent).toBe('段落')
    expect(numbering('1. <!-- writer:list i. -->\n   1. 甲')).toEqual(['1.', 'i.'])
    expect(numbering('<!--writer:list\t(1)-->\n1. 甲')).toEqual(['(1)'])
    // 中间有空行、样式不认识、多余的文字、缩进成代码：都是文字。
    for (const markdown of ['<!-- writer:list (1) -->\n\n1. 甲', '<!-- writer:list (2) -->\n1. 甲', '<!-- writer:list (1) --> x\n1. 甲']) {
      expect(numbering(markdown)).toEqual(['1.'])
      expect(parseMarkdown(markdown).child(0).type).toBe(p)
    }
    expect(parseMarkdown('    <!-- writer:list (1) -->\n1. 甲').child(0).type).toBe(code_block)
  })

  test('文字中的编号样式注释写出时转义，不会变成样式', () => {
    const node = doc.create(null, [p.create(null, text('<!-- writer:list (1) -->')), ordered_list.create(null, list_item.create(null, p.create(null, text('甲'))))])
    expectStable(node)
  })

  test('按块缓存的写法随位置更新：删掉两个列表之间的段落后，后一个列表换用另一种标记', () => {
    const first = bullet_list.create(null, list_item.create(null, p.create(null, text('一'))))
    const second = bullet_list.create(null, list_item.create(null, p.create(null, text('二'))))
    expect(write(doc.create(null, [first, p.create(null, text('中间')), second]))).toBe('- 一\n\n中间\n\n- 二\n')
    expect(write(doc.create(null, [first, second]))).toBe('- 一\n\n\n* 二\n')
    expect(write(doc.create(null, [first, p.create(null, text('中间')), second]))).toBe('- 一\n\n中间\n\n- 二\n')
  })

  test('任务列表', () => {
    const item = (checked: boolean | null, value: string) =>
      list_item.create({ checked }, p.create(null, text(value)))
    const node = doc.create(null, bullet_list.create(null, [item(false, '待办'), item(true, '完成'), item(null, '普通')]))
    expect(expectStable(node)).toBe('- [ ] 待办\n- [x] 完成\n- 普通\n')
  })

  test('顶层空段落省略；空文档写成空正文', () => {
    expect(write(doc.create(null, p.create()))).toBe('')
    expect(write(doc.create(null, [p.create(), p.create(null, text('正文')), p.create()]))).toBe('正文\n')
  })

  test('对行首有特殊含义的文字转义（段落开头与硬换行之后）', () => {
    for (const value of ['- 不是列表', '+ 不是列表', '* 不是列表', '1. 不是列表', '1) 不是列表', '# 不是标题', '> 不是引用', '===', '---', '```', '| a | b |']) {
      expectStable(doc.create(null, p.create(null, text(value))))
      expectStable(doc.create(null, p.create(null, [text('第一行'), hard_break.create(), text(value)])))
    }
  })

  test('HTML、实体、强调符号等写成文字，再次解析仍是原文字', () => {
    for (const value of ['<div>x</div>', '&amp; &#123;', 'a*b*c', 'snake_case_name', '[不是链接](x)', '`反引号`', 'a\\b', '~~不删除~~', '!不是图片']) {
      expectStable(doc.create(null, p.create(null, text(value))))
    }
  })

  test('行首空白在 Markdown 中不显示：写出时去掉，不会变成代码块', () => {
    const written = write(doc.create(null, p.create(null, text('    缩进的文字'))))
    expect(written).toBe('缩进的文字\n')
    expect(parseMarkdown(written).child(0).type).toBe(p)
  })

  test('格式嵌套与空白', () => {
    expectStable(
      doc.create(null, p.create(null, [text('前'), text('粗', 'strong'), text('粗斜', 'strong', 'em'), text('后')])),
    )
    // 标记内的首尾空格移到标记外（CommonMark 不允许 ** 内侧紧挨空白）。
    expect(write(doc.create(null, p.create(null, [text('a'), text(' b ', 'strong'), text('c')])))).toBe('a **b** c\n')
  })

  test('标记边界紧挨中文标点时，把标点移到标记外，保证格式不会变成字面的星号', () => {
    const written = write(
      doc.create(null, p.create(null, [text('这是'), text('“重要”', 'strong'), text('的，'), text('（注）', 'em'), text('后')])),
    )
    // 只调整不满足规则的一侧：（ 之前是标点，* 可以留在它前面。
    expect(written).toBe('这是“**重要**”的，*（注*）后\n')
    expect(parseMarkdown(written).toJSON()).toEqual(
      doc
        .create(null, p.create(null, [text('这是“'), text('重要', 'strong'), text('”的，'), text('（注', 'em'), text('）后')]))
        .toJSON(),
    )
    // 外侧是空白或标点时标记本身就能生效，不做调整。
    expect(write(doc.create(null, p.create(null, [text('“重要”', 'strong'), text('，')])))).toBe('**“重要”**，\n')
    // 全是标点、无法表达的格式去掉，文字保留。
    expect(write(doc.create(null, p.create(null, [text('甲'), text('“', 'strong'), text('乙')])))).toBe('甲“乙\n')
  })

  test('行内代码：内容含反引号或首尾空格时仍能原样读回', () => {
    for (const code of ['a`b', '`x`', ' 两侧空格 ', '``', '  ']) {
      expectStable(doc.create(null, p.create(null, [text('前'), text(code, 'code'), text('后')])))
    }
  })

  test('代码块内容包含 ``` 时使用更长的围栏', () => {
    expectStable(doc.create(null, code_block.create(null, text('```\ninner\n```'))))
  })

  test('列表中的多段、引用与代码块', () => {
    expectStable(
      doc.create(
        null,
        ordered_list.create({ order: 1, tight: false }, [
          list_item.create(null, [p.create(null, text('第一段')), p.create(null, text('第二段'))]),
          list_item.create(null, [blockquote.create(null, p.create(null, text('引用'))), code_block.create(null, text('code'))]),
        ]),
      ),
    )
  })
})

describe('往返', () => {
  test('当前支持的各类结构往返后不丢失', () => {
    for (const markdown of [
      '本节介绍**实验设计**与*变量控制*。\n',
      '一\n\n二\n',
      '- a\n  - b\n    - c\n- d\n\n1. x\n2. y\n',
      '5. 从五开始\n6. 六\n',
      '- 松散\n\n- 列表\n',
      '- [ ] 待办\n- [x] 完成\n',
      '> 引用\n>\n> > 嵌套引用\n\n---\n',
      '```js\nconst a = 1\n```\n',
      '| 组别 | 样本数 |\n| --- | ---: |\n| 对照组 | 30 |\n| 实验组 |  |\n',
      '![实验装置](../assets/实验装置.png)\n\n文字中的![图](a.png "标题")图片\n',
      '[链接](https://example.com/a_(b) "标题") 与 <https://example.com>\n',
      '甲  \n乙\n',
      '~~删除~~ `a|b` ``含`反引号``\n',
      '# 一级\n\n###### 六级\n',
      '* 星号\n+ 加号\n',
      'Setext 标题\n===\n',
      '[引用式链接][r]\n\n[r]: https://example.com\n',
    ]) {
      expectRoundTrip(markdown)
    }
  })

  test('解析 → 编辑 → 序列化：只有被编辑的部分改变', () => {
    const { doc: parsed, format } = parseChapter('> 引用\n\n第一段\n\n- 列表\n')
    const paragraphEnd = parsed.child(0).nodeSize + parsed.child(1).nodeSize - 1
    const edited = EditorState.create({ doc: parsed }).tr.insert(paragraphEnd, text('补充', 'strong')).doc
    expect(serializeChapter(edited, format)).toBe('> 引用\n\n第一段**补充**\n\n- 列表\n')
  })

  test('随机文档：写出后再次解析，结构与文字不变', () => {
    const random = seededRandom(20260928)
    const pick = <T,>(items: readonly T[]): T => items[Math.floor(random() * items.length)]
    const pieces = ['中文', 'abc', ' ', '*', '_', '`', '[', ']', '\\', '#', '-', '1.', '1)', '+', '=', '|', '<a>', '<sup>', '</sub>', '&amp;', '!', '~', '>', '“', '”', '，', '    ', 'http://x.y', '](', '---']
    const markSets: ReadonlyArray<ReadonlyArray<'strong' | 'em' | 'strike' | 'sup' | 'sub' | 'code' | 'link'>> = [[], ['strong'], ['em'], ['strong', 'em'], ['code'], ['strike'], ['link'], ['sup'], ['sub'], ['sup', 'strong'], ['sub', 'em'], ['sup', 'code']]

    const inline = (allowBreak: boolean): Node[] => {
      const out: Node[] = []
      const count = 1 + Math.floor(random() * 6)
      for (let i = 0; i < count; i++) {
        const roll = random()
        if (roll < 0.08 && allowBreak && out.length > 0) out.push(hard_break.create())
        else if (roll < 0.16) out.push(image.create({ src: pick(['a b.png', 'x(1).png']), alt: pick(pieces) }))
        else {
          const value = Array.from({ length: 1 + Math.floor(random() * 3) }, () => pick(pieces)).join('')
          // 只有空白的行内代码 / 强调没有意义，不生成。
          const names = /^\s*$/.test(value) ? [] : pick(markSets)
          out.push(schema.text(value, names.map((name) => (name === 'link' ? marks.link.create({ href: 'http://e.com/a b' }) : marks[name].create()))))
        }
      }
      if (!out.some((node) => node.type === image || /\S/.test(node.text ?? ''))) out.push(text('x'))
      return out
    }
    const block = (depth: number): Node => {
      const roll = depth > 3 ? 0 : Math.floor(random() * 8)
      if (roll === 1) return blockquote.create(null, [block(depth + 1)])
      if (roll === 2 || roll === 3) {
        const item = () =>
          list_item.create({ checked: pick([null, null, true, false]) }, [
            p.create(null, inline(true)),
            ...(random() < 0.3 ? [block(depth + 1)] : []),
          ])
        if (roll === 2) return bullet_list.create({ tight: random() < 0.5 }, [item(), item()])
        const numbering = pick(['1.', '1.', '一、', '（一）', 'a.'])
        return ordered_list.create({ tight: random() < 0.5, numbering }, [item(), item()])
      }
      if (roll === 4) return code_block.create({ params: pick(['', 'js']) }, text('x = `a`\n```\n  y'))
      if (roll === 5) {
        const row = (type: typeof table_cell) =>
          table_row.create(null, [type.create(null, inline(false)), type.create(null, inline(false))])
        return table.create(null, [row(table_header), row(table_cell)])
      }
      if (roll === 7) return horizontal_rule.create()
      return p.create(null, inline(true))
    }
    // 除空白与硬换行外只有一张（不带链接的）图片的段落，写出后就是独立成段的图，再次解析得到 figure。
    const soleImage = (node: Node) => {
      const content = node.children.filter((c) => !(c.isText && /^[ \t]*$/.test(c.text!)) && c.type !== hard_break)
      return node.type === p && content.length === 1 && content[0].type === image && content[0].marks.length === 0
    }
    const shape = (node: Node): unknown =>
      soleImage(node)
        ? 'figure'
        : node.isTextblock || node.isLeaf
          ? node.type.name
          : [
              node.type === ordered_list ? `${node.type.name} ${node.attrs.numbering as string}` : node.type.name,
              ...Array.from({ length: node.childCount }, (_, i) => shape(node.child(i))),
            ]
    const visible = (node: Node) => node.textContent.replace(/\s+/g, '')

    for (let round = 0; round < 1000; round++) {
      const original = doc.create(null, Array.from({ length: 1 + Math.floor(random() * 4) }, () => block(0)))
      const reparsed = parseMarkdown(write(original))
      expect(shape(reparsed)).toEqual(shape(original))
      expect(visible(reparsed)).toBe(visible(original))
    }
  })
})

/** 可复现的伪随机数（mulberry32）。 */
function seededRandom(seed: number): () => number {
  let state = seed
  return () => {
    state = (state + 0x6d2b79f5) | 0
    let t = Math.imul(state ^ (state >>> 15), 1 | state)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

describe('章节正文格式', () => {
  test('未编辑时 parse → serialize 不需要：CRLF、BOM、结尾换行在编辑后保持', () => {
    const crlf = parseChapter('一\r\n\r\n二\r\n')
    expect(crlf.format).toEqual({ crlf: true, bom: false, finalNewline: true })
    expect(serializeChapter(crlf.doc, crlf.format)).toBe('一\r\n\r\n二\r\n')

    const bom = parseChapter('﻿正文\n')
    expect(bom.doc.textContent).toBe('正文')
    expect(serializeChapter(bom.doc, bom.format)).toBe('﻿正文\n')

    const noNewline = parseChapter('正文')
    expect(serializeChapter(noNewline.doc, noNewline.format)).toBe('正文')

    const mixed = parseChapter('一\r\n\r\n二\n')
    expect(serializeChapter(mixed.doc, mixed.format)).toBe('一\n\n二\n')
  })

  test('空章节写入内容后以换行结尾', () => {
    const empty = parseChapter('')
    expect(serializeChapter(doc.create(null, p.create(null, text('新内容'))), empty.format)).toBe('新内容\n')
  })
})

describe('异常与遗留内容', () => {
  test('任何输入都能解析，不抛出', () => {
    for (const markdown of [
      '- ',
      '-\n  ```\n  code\n  ```',
      '> ',
      '|',
      '| a |\n| - |',
      '![](',
      '[](',
      '```',
      '<!-- 注释 -->',
      '\u0000\u0001控制字符',
      '[^1]\n\n[^1]: 脚注',
      '$$\nmath\n$$',
      '# \n\n#',
      '1. \n2. ',
    ]) {
      const parsed = parseMarkdown(markdown)
      expect(parsed.type).toBe(doc)
      parsed.check()
    }
  })

  test('列表项以代码块开头时不插入多余的空段落', () => {
    const item = parseMarkdown('- ```\n  code\n  ```\n').child(0).child(0)
    expect(item.childCount).toBe(1)
    expect(item.child(0).type).toBe(code_block)
  })

  test('深层嵌套（32 层引用与列表，超过 Rust 渲染器的上限）不丢内容', () => {
    const quotes = `${'> '.repeat(32)}深处的文字\n`
    expect(parseMarkdown(quotes).textContent).toBe('深处的文字')
    expectRoundTrip(quotes)
    const lists = Array.from({ length: 32 }, (_, i) => `${'  '.repeat(i)}- 第 ${i + 1} 层`).join('\n')
    expect(parseMarkdown(lists).textContent).toContain('第 32 层')
    expectRoundTrip(lists)
  })
})

describe('appendImage', () => {
  test('把图片作为新的一段追加，保留原有正文的每一个字节', () => {
    expect(appendImage('', '../assets/a.png', 'a')).toBe('![a](../assets/a.png)\n')
    expect(appendImage('正文', '../assets/a.png', 'a')).toBe('正文\n\n![a](../assets/a.png)\n')
    expect(appendImage('正文\n', '../assets/a.png', 'a')).toBe('正文\n\n![a](../assets/a.png)\n')
    expect(appendImage('正文\n\n', '../assets/a.png', 'a')).toBe('正文\n\n![a](../assets/a.png)\n')
  })

  test('替代文字中的方括号被转义，引用中的空格用尖括号包裹', () => {
    const appended = appendImage('', '../assets/实验 图.png', '图[1]')
    expect(appended).toBe('![图\\[1\\]](<../assets/实验 图.png>)\n')
    expect(parseMarkdown(appended).child(0).attrs).toMatchObject({ src: '../assets/实验 图.png', alt: '图[1]' })
  })
})

describe('章节引用', () => {
  const ref = (href: string, cached: string, ...markNames: Array<keyof typeof marks>) =>
    nodes.chapter_ref.create({ href, cached }, null, markNames.map((name) => marks[name].create()))

  test('引用写成标准链接，地址原样保留', () => {
    const written = expectStable(
      doc.create(null, p.create(null, [text('见'), ref('writer:chapter/a?show=page', '[2.1] *方法*'), text('。')])),
    )
    expect(written).toBe('见[\\[2.1\\] \\*方法\\*](writer:chapter/a?show=page)。\n')
  })

  test('引用的粗体按 Markdown 定界规则写出：紧挨中文时不能表达，去掉粗体，文字不变', () => {
    const edge = doc.create(null, p.create(null, [ref('writer:chapter/a', '方法', 'strong'), text(' 之后')]))
    expect(expectStable(edge)).toBe('**[方法](writer:chapter/a)** 之后\n')

    const inner = doc.create(null, p.create(null, [text('见'), ref('writer:chapter/a', '方法', 'strong'), text('一节')]))
    const written = write(inner)
    expect(written).toBe('见[方法](writer:chapter/a)一节\n')
    expect(parseMarkdown(written).toJSON()).toEqual(
      doc.create(null, p.create(null, [text('见'), ref('writer:chapter/a', '方法'), text('一节')])).toJSON(),
    )
  })

  test('引用上的链接与行内代码无法表达，写出时去掉，引用不变', () => {
    const linked = ref('writer:chapter/a', '方法').mark([marks.link.create({ href: 'https://a.com' })])
    const coded = ref('writer:chapter/b', '结果').mark([marks.code.create()])
    expect(write(doc.create(null, p.create(null, [linked, text('与'), coded])))).toBe(
      '[方法](writer:chapter/a)与[结果](writer:chapter/b)\n',
    )
  })

  test('粘贴的 HTML：地址是引用的链接成为引用，编辑器复制出的引用原样读回', () => {
    const html = document.createElement('div')
    html.innerHTML =
      '<p>见<a href="writer:chapter/a?show=number">2.1</a>与<span class="chapter-ref" data-chapter-ref="writer:chapter/b">3 结果</span></p>'
    const parsed = PMDOMParser.fromSchema(schema).parse(html)
    expect(parsed.toJSON()).toEqual(
      doc
        .create(null, p.create(null, [text('见'), ref('writer:chapter/a?show=number', '2.1'), text('与'), ref('writer:chapter/b', '3 结果')]))
        .toJSON(),
    )
  })
})

describe('上标与下标', () => {
  test('<sup> / <sub> 是上下标，紧挨文字也生效；配不上的、大写的、带属性的、转义的标签是文字', () => {
    expect(parseMarkdown('50 m<sup>3</sup>/d，H<sub>2</sub>O').toJSON()).toEqual(
      doc.create(null, p.create(null, [text('50 m'), text('3', 'sup'), text('/d，H'), text('2', 'sub'), text('O')])).toJSON(),
    )
    for (const source of ['a<sup>b c</sub>', '<SUP>d</SUP>', '<sup class="x">e</sup>', '<sup >e</sup>', 'f</sup>']) {
      expect(parseMarkdown(source).toJSON()).toEqual(doc.create(null, p.create(null, text(source))).toJSON())
    }
    expect(parseMarkdown('\\<sup>f</sup>').textContent).toBe('<sup>f</sup>')
  })

  test('只与同一层中的标签配对；嵌套时以外层为准', () => {
    expect(parseMarkdown('<sup>*a</sup>*').toJSON()).toEqual(
      doc.create(null, p.create(null, [text('<sup>'), text('a</sup>', 'em')])).toJSON(),
    )
    expect(parseMarkdown('<sup>a<sub>b</sup>c</sub>').toJSON()).toEqual(
      doc.create(null, p.create(null, [text('a<sub>b', 'sup'), text('c</sub>')])).toJSON(),
    )
    expect(parseMarkdown('<sup>a<sub>b</sub>*<sup>c</sup>*</sup>').toJSON()).toEqual(
      doc.create(null, p.create(null, [text('ab', 'sup'), text('c', 'sup', 'em')])).toJSON(),
    )
  })

  test('图片描述、脚注、章节引用中的上下标只取文字（与导出相同）', () => {
    expect(parseMarkdown('![面积 m<sup>2</sup>](a.png)').child(0).attrs.alt).toBe('面积 m2')
    let footnote = ''
    parseMarkdown('注[^1]\n\n[^1]: 单位 m<sup>3</sup>').descendants((node) => {
      if (node.type === nodes.footnote) footnote = node.attrs.text as string
    })
    expect(footnote).toBe('单位 m3')
  })

  test('写出：标签写在强调之外，强调与上下标同时出现时格式不丢失', () => {
    expect(expectStable(doc.create(null, p.create(null, [text('x'), text('n', 'sup', 'em'), text('。')])))).toBe('x<sup>*n*</sup>。\n')
    // 粗体跨过上标：在上标处分成两段粗体，紧挨中文时同样能读回。
    expect(expectStable(doc.create(null, p.create(null, [text('是'), text('m', 'strong'), text('3', 'strong', 'sup'), text('的')])))).toBe(
      '是**m**<sup>**3**</sup>的\n',
    )
    // 标签外侧是标点：内侧是标点的强调可以紧挨标签。
    expect(expectStable(doc.create(null, p.create(null, [text('x'), text('“n”', 'sup', 'strong'), text('y')])))).toBe('x<sup>**“n”**</sup>y\n')
    // 文字中的标签写成转义的文字。
    expect(expectStable(doc.create(null, p.create(null, text('<sup>a</sup>'))))).toBe('\\<sup>a\\</sup>\n')
  })

  test('粘贴的 HTML：<sup> / <sub> 与 vertical-align 是上下标，编辑器中的脚注编号仍是脚注', () => {
    const html = document.createElement('div')
    html.innerHTML =
      '<p>m<sup>3</sup>、H<sub>2</sub>O、x<span style="vertical-align: super">n</span>、注<sup class="footnote-ref" data-footnote="内容"></sup></p>'
    const parsed = PMDOMParser.fromSchema(schema).parse(html)
    expect(parsed.toJSON()).toEqual(
      doc
        .create(null, p.create(null, [
          text('m'), text('3', 'sup'), text('、H'), text('2', 'sub'), text('O、x'), text('n', 'sup'), text('、注'),
          nodes.footnote.create({ text: '内容' }),
        ]))
        .toJSON(),
    )
  })
})
