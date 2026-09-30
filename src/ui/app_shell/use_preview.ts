import { onBeforeUnmount, ref, watch, type Ref, type WatchSource } from 'vue'
import type { OutputResult } from '../../application/document_output.ts'
import { messageForOutputFailure } from './output_messages.ts'

const PREVIEW_DELAY_MS = 400

export interface Preview {
  readonly html: Readonly<Ref<string>>
  readonly error: Readonly<Ref<string | null>>
  /** 打开预览：清空上一次的结果并立即渲染。 */
  open(): void
}

/**
 * 全文预览的渲染结果。预览打开（active）时，source 变化后防抖重新渲染；
 * 只采用最新一次请求的结果，避免较慢的旧请求覆盖新内容，预览关闭后到达的结果也不采用。
 */
export function usePreview(options: {
  readonly source: WatchSource<unknown>
  readonly active: () => boolean
  readonly render: () => Promise<OutputResult<string>>
}): Preview {
  const html = ref('')
  const error = ref<string | null>(null)
  let timer: ReturnType<typeof setTimeout> | null = null
  let request = 0

  async function refresh(): Promise<void> {
    const current = ++request
    const result = await options.render()
    if (current !== request || !options.active()) return
    if (result.ok) {
      html.value = result.value
      error.value = null
    } else {
      error.value = messageForOutputFailure(result.error)
    }
  }

  function open(): void {
    html.value = ''
    void refresh()
  }

  watch(options.source, () => {
    if (!options.active()) return
    if (timer !== null) clearTimeout(timer)
    timer = setTimeout(() => {
      timer = null
      void refresh()
    }, PREVIEW_DELAY_MS)
  })

  onBeforeUnmount(() => {
    if (timer !== null) clearTimeout(timer)
  })

  return { html, error, open }
}
