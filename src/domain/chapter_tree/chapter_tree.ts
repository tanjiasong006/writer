export type ChapterId = string

export interface ChapterNode {
  id: ChapterId
  title: string
  children: ChapterNode[]
}

export type ChapterTree = ChapterNode[]

/** 一条校验问题。path 指向出问题的位置。 */
export interface TreeIssue {
  path: string
  message: string
}

/**
 * 校验结果：成功时给出可信的 ChapterTree，失败时给出全部问题。
 * 判别字段是 ok。
 */
export type ValidateTreeResult =
  | { ok: true; tree: ChapterTree }
  | { ok: false; issues: TreeIssue[] }

/**
 * 校验一棵章节树。
 *
 * 输入声明为 unknown，因为章节树常来自外部数据（文件、粘贴、导入），
 * 必须在信任边界上做运行时结构检查。只有校验通过才会返回 ok: true，
 * 此时 tree 可被当作可信的 ChapterTree 使用。
 */
export function validateTree(tree: unknown): ValidateTreeResult {
  const issues: TreeIssue[] = []
  const seenIds = new Set<string>()
  const seenNodes = new WeakSet<object>()

  const visit = (node: unknown, path: string): void => {
    if (typeof node !== 'object' || node === null || Array.isArray(node)) {
      issues.push({ path, message: '节点必须是对象' })
      return
    }

    // 同一对象被再次遇到 = 循环引用或共享节点，继续递归会无限展开。
    if (seenNodes.has(node)) {
      issues.push({ path, message: '节点被重复引用，存在循环或共享' })
      return
    }
    seenNodes.add(node)

    const n = node as Record<string, unknown>

    if (typeof n.id !== 'string' || n.id.length === 0) {
      issues.push({ path, message: 'id 必须是非空字符串' })
    } else if (seenIds.has(n.id)) {
      issues.push({ path, message: `id 重复: ${n.id}` })
    } else {
      seenIds.add(n.id)
    }

    if (typeof n.title !== 'string') {
      issues.push({ path, message: 'title 必须是字符串' })
    }

    if (!Array.isArray(n.children)) {
      issues.push({ path, message: 'children 必须是数组' })
      return
    }

    n.children.forEach((child, i) => visit(child, `${path}.children[${i}]`))
  }

  if (!Array.isArray(tree)) {
    return { ok: false, issues: [{ path: 'root', message: '章节树必须是数组' }] }
  }

  tree.forEach((node, i) => visit(node, `[${i}]`))

  // 唯一的类型断言点：走到这里结构已全部校验通过，树可信。
  return issues.length === 0
    ? { ok: true, tree: tree as ChapterTree }
    : { ok: false, issues }
}
