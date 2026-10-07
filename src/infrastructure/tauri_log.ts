import { error as logError, warn as logWarn } from '@tauri-apps/plugin-log'

/**
 * 把前端的 console.error / console.warn 与未处理的异常写入应用日志文件（Rust 端见 src-tauri/src/app_log.rs），
 * 正式版中没有开发者工具时也能从用户电脑上取回错误。控制台照常输出。
 */
export function installErrorLog(): void {
  forward('error', logError)
  forward('warn', logWarn)
  window.addEventListener('error', (event) => {
    write(logError, ['uncaught:', event.error ?? event.message, `at ${event.filename}:${event.lineno}:${event.colno}`])
  })
  window.addEventListener('unhandledrejection', (event) => {
    write(logError, ['unhandled rejection:', event.reason])
  })
}

function forward(level: 'error' | 'warn', sink: (message: string) => Promise<void>): void {
  const original = console[level].bind(console)
  console[level] = (...args: unknown[]) => {
    original(...args)
    write(sink, args)
  }
}

function write(sink: (message: string) => Promise<void>, args: readonly unknown[]): void {
  // 写日志失败时不再报告（避免经 console.error 循环）。
  sink(formatLogArgs(args)).catch(() => {})
}

/** 日志中的一行：字符串原样，Error（含 DOMException）写出名称、消息与调用栈，其他值写成 JSON。 */
export function formatLogArgs(args: readonly unknown[]): string {
  return args.map((arg) => (typeof arg === 'string' ? arg : stringify(arg))).join(' ')
}

function stringify(value: unknown): string {
  if (value instanceof Error) return describeError(value)
  try {
    return JSON.stringify(value, (_key, item: unknown) => (item instanceof Error ? describeError(item) : item)) ?? String(value)
  } catch {
    return String(value)
  }
}

function describeError(error: Error): string {
  const head = `${error.name}: ${error.message}`
  return error.stack?.includes(error.message) ? error.stack : `${head}${error.stack ? `\n${error.stack}` : ''}`
}
