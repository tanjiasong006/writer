import { Plugin } from 'prosemirror-state'
import { closeHistory } from 'prosemirror-history'
import { Decoration, DecorationSet } from 'prosemirror-view'
import { nodes } from './schema.ts'

/** 复选框只属于编辑视图；任务状态通过正文事务修改，阅读与 Markdown 不包含控件。 */
export function taskList(): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const decorations: Decoration[] = []
        state.doc.descendants((node, pos) => {
          if (node.type !== nodes.list_item || node.attrs.checked === null) return
          decorations.push(Decoration.node(pos, pos + node.nodeSize, { class: 'editor-task' }))
          decorations.push(Decoration.widget(pos + 1, (view, getPos) => {
            const box = document.createElement('input')
            box.type = 'checkbox'
            box.className = 'editor-task__checkbox'
            box.checked = node.attrs.checked as boolean
            box.setAttribute('aria-label', node.firstChild?.textContent || '任务')
            box.addEventListener('change', () => {
              const position = getPos()
              if (position === undefined) return
              const item = view.state.doc.nodeAt(position - 1)
              if (item?.type !== nodes.list_item || item.attrs.checked === null) return
              if (!view.editable) {
                box.checked = item.attrs.checked as boolean
                return
              }
              const focused = document.activeElement === box
              view.dispatch(closeHistory(view.state.tr).setNodeMarkup(position - 1, undefined, {
                ...item.attrs, checked: box.checked,
              }))
              if (focused) {
                const dom = view.nodeDOM(position - 1)
                if (dom instanceof Element) {
                  dom.querySelector<HTMLInputElement>(':scope > .editor-task__checkbox')?.focus({ preventScroll: true })
                }
              }
            })
            return box
          }, {
            side: -1,
            // 撤销仍交给正文；Space / Tab 等使用复选框的原生键盘行为。
            stopEvent: (event) => !(event instanceof KeyboardEvent && (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'z'),
            ignoreSelection: true,
          }))
        })
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
}
