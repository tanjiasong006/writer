// markdown-it-footnote 没有与本项目 @types/markdown-it 版本兼容的类型定义：只声明这里用到的插件函数。
declare module 'markdown-it-footnote' {
  import type MarkdownIt from 'markdown-it'
  const footnote: (md: MarkdownIt) => void
  export default footnote
}
