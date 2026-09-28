import type { Node, Schema } from 'prosemirror-model'
import { NodeSelection, Plugin, PluginKey, type Command, type EditorState, type Transaction } from 'prosemirror-state'
import { Step, StepMap, StepResult } from 'prosemirror-transform'
import { closeHistory } from 'prosemirror-history'
import { Decoration, DecorationSet } from 'prosemirror-view'
import {
  THEMES,
  imageKey,
  isImageAlign,
  isImageSize,
  type ImageLayout,
  type ImageLayouts,
  type ImageOverride,
} from '../../domain/document_style/document_style.ts'
import { nodes } from './schema.ts'

/**
 * 编辑器中的图片布局（尺寸 / 对齐）。
 *
 * 布局不属于正文：它按图片文件键（imageKey）保存在文档样式中（docs/decisions.md 第 8 节），
 * ProseMirror 文档与 Markdown 都不包含它。编辑器这样使用它：
 * - 插件状态持有当前的图片布局与主题默认布局，独立成段的图片（figure）按它加上
 *   data-image-size / data-image-align 装饰，由 CSS 呈现；
 * - 用户修改布局时产生一个 ImageLayoutStep：它不改变文档，但作为事务中的 step 进入撤销历史，
 *   因此 Cmd+Z / Shift+Cmd+Z 能撤销 / 重做布局修改，选区不受影响；
 * - 编辑器把这些 step 报告给上层（写入文档样式）；上层的布局变化再以不进入历史的同步事务回到插件状态。
 */

export interface ImageLayoutState {
  /** 图片文件键 → 该图片自己的布局。 */
  readonly layouts: ImageLayouts
  /** 主题默认布局。 */
  readonly defaults: ImageLayout
}

export const imageLayoutKey = new PluginKey<ImageLayoutState>('imageLayout')

/**
 * 修改一张图片的布局：from / to 是修改前后该图片自己的布局（null 表示跟随主题）。
 * 文档本身不变（映射为空），反转即交换 from / to。
 */
export class ImageLayoutStep extends Step {
  constructor(
    readonly key: string,
    readonly from: ImageOverride | null,
    readonly to: ImageOverride | null,
  ) {
    super()
  }

  apply(doc: Node): StepResult {
    return StepResult.ok(doc)
  }

  getMap(): StepMap {
    return StepMap.empty
  }

  invert(): ImageLayoutStep {
    return new ImageLayoutStep(this.key, this.to, this.from)
  }

  map(): ImageLayoutStep {
    return this
  }

  toJSON(): unknown {
    return { stepType: 'writerImageLayout', key: this.key, from: this.from, to: this.to }
  }

  static fromJSON(_schema: Schema, json: { key: string; from: ImageOverride | null; to: ImageOverride | null }): ImageLayoutStep {
    return new ImageLayoutStep(json.key, json.from, json.to)
  }
}

Step.jsonID('writerImageLayout', ImageLayoutStep)

function sameOverride(a: ImageOverride | null | undefined, b: ImageOverride | null | undefined): boolean {
  return (a?.size ?? null) === (b?.size ?? null) && (a?.align ?? null) === (b?.align ?? null)
}

function sameLayouts(a: ImageLayouts, b: ImageLayouts): boolean {
  if (a === b) return true
  if (a.size !== b.size) return false
  for (const [key, layout] of a) if (!sameOverride(layout, b.get(key))) return false
  return true
}

/** 只含一张图片的段落：与预览 / 导出一样作为独立的图（figure）显示，才有布局。 */
function figureImage(node: Node): Node | null {
  return node.type === nodes.paragraph && node.childCount === 1 && node.firstChild!.type === nodes.image
    ? node.firstChild
    : null
}

export function effectiveLayout(state: ImageLayoutState, key: string | null): ImageLayout {
  const own = key === null ? undefined : state.layouts.get(key)
  return { size: own?.size ?? state.defaults.size, align: own?.align ?? state.defaults.align }
}

export function imageLayoutPlugin(): Plugin<ImageLayoutState> {
  return new Plugin<ImageLayoutState>({
    key: imageLayoutKey,
    state: {
      init: () => ({ layouts: new Map(), defaults: { size: THEMES.book.image.size, align: THEMES.book.image.align } }),
      apply(tr, value) {
        const synced = tr.getMeta(imageLayoutKey) as ImageLayoutState | undefined
        let next = synced ?? value
        for (const step of tr.steps) {
          if (!(step instanceof ImageLayoutStep)) continue
          const layouts = new Map(next.layouts)
          if (step.to === null) layouts.delete(step.key)
          else layouts.set(step.key, step.to)
          next = { ...next, layouts }
        }
        return next
      },
    },
    props: {
      decorations(state) {
        const layout = imageLayoutKey.getState(state)!
        const decorations: Decoration[] = []
        state.doc.descendants((node, pos) => {
          if (node.type !== nodes.paragraph) return !node.isTextblock
          const image = figureImage(node)
          if (image) {
            const { size, align } = effectiveLayout(layout, imageKey(image.attrs.src as string))
            decorations.push(
              Decoration.node(pos, pos + node.nodeSize, {
                class: 'is-figure',
                'data-image-size': size,
                'data-image-align': align,
              }),
            )
          }
          return false
        })
        return DecorationSet.create(state.doc, decorations)
      },
    },
  })
}

/**
 * 把上层的图片布局与主题默认布局同步进编辑器状态；已一致时返回 null。
 * 同步事务不改变文档、不进入撤销历史。
 */
export function syncImageLayouts(state: EditorState, layouts: ImageLayouts, defaults: ImageLayout): Transaction | null {
  const current = imageLayoutKey.getState(state)
  if (!current) return null
  if (sameLayouts(current.layouts, layouts) && sameOverride(current.defaults, defaults)) return null
  return state.tr.setMeta(imageLayoutKey, { layouts, defaults }).setMeta('addToHistory', false)
}

export interface SelectedFigure {
  readonly key: string
  /** 图片自己的布局（没有则为 null，跟随主题）。 */
  readonly own: ImageOverride | null
  /** 实际显示的布局。 */
  readonly layout: ImageLayout
}

/** 当前选中的独立成段的图片（有图片文件键的）；否则返回 null。 */
export function selectedFigure(state: EditorState): SelectedFigure | null {
  const { selection } = state
  if (!(selection instanceof NodeSelection) || selection.node.type !== nodes.image) return null
  if (figureImage(selection.$from.parent) !== selection.node) return null
  const key = imageKey(selection.node.attrs.src as string)
  const layout = imageLayoutKey.getState(state)
  if (key === null || !layout) return null
  return { key, own: layout.layouts.get(key) ?? null, layout: effectiveLayout(layout, key) }
}

/**
 * 修改选中图片的布局。与主题默认相同的字段不单独记录（跟随主题），
 * 因此选择与主题默认一致的尺寸 / 对齐就是"恢复跟随主题"。布局没有变化时不可用。
 */
export function setFigureLayout(patch: ImageOverride): Command {
  return (state, dispatch) => {
    const figure = selectedFigure(state)
    const layout = imageLayoutKey.getState(state)
    if (!figure || !layout) return false
    const merged = { ...figure.own, ...patch }
    const next: { size?: ImageOverride['size']; align?: ImageOverride['align'] } = {}
    if (isImageSize(merged.size) && merged.size !== layout.defaults.size) next.size = merged.size
    if (isImageAlign(merged.align) && merged.align !== layout.defaults.align) next.align = merged.align
    const to = Object.keys(next).length === 0 ? null : next
    if (sameOverride(figure.own, to)) return false
    if (dispatch) dispatch(closeHistory(state.tr).step(new ImageLayoutStep(figure.key, figure.own, to)))
    return true
  }
}

/** 事务中的布局修改（包括撤销 / 重做产生的），按发生顺序。 */
export function layoutChanges(tr: Transaction): ReadonlyArray<{ key: string; layout: ImageOverride | null }> {
  return tr.steps
    .filter((step): step is ImageLayoutStep => step instanceof ImageLayoutStep)
    .map((step) => ({ key: step.key, layout: step.to }))
}
