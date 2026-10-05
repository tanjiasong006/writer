// markdown-it 的 GFM 表格规则没有单独的类型定义：只声明这里用到的规则函数（合并单元格在它之上处理）。
declare module 'markdown-it/lib/rules_block/table.mjs' {
  import type StateBlock from 'markdown-it/lib/rules_block/state_block.mjs'
  const table: (state: StateBlock, startLine: number, endLine: number, silent: boolean) => boolean
  export default table
}
