/**
 * 界面图标：16×16 网格、1.4 线宽的单色线条（SVG path），颜色跟随文字。
 * 不用 emoji 或符号字符：它们在不同系统上字形、大小和颜色都不一致。
 */
export const ICONS = {
  'chevron-right': 'M6.5 4 10.5 8l-4 4',
  'chevron-down': 'M4.5 6.5 8 10l3.5-3.5',
  plus: 'M8 3.5v9M3.5 8h9',
  more: 'M3.5 8h.01M8 8h.01M12.5 8h.01',
  'bullet-list': 'M6 4h8M6 8h8M6 12h8M2.5 4h.01M2.5 8h.01M2.5 12h.01',
  'ordered-list': 'M7 4h7M7 8h7M7 12h7M2 3l1-.5V6M2 9.5c.5-.6 2-.6 2 .3 0 .8-2 1.2-2 2.2h2',
  quote: 'M3 3v10M6.5 5h7M6.5 8h7M6.5 11h5',
  'code-block': 'M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5',
  table: 'M2.5 3h11v10h-11zM2.5 6.5h11M2.5 9.8h11M6.2 3v10M9.8 3v10',
  image: 'M2.5 3h11v10h-11zM2.5 11l3.2-3.2 2.3 2.3 2-2 3.5 3.4M10.5 6h.01',
  'align-left': 'M2.5 3v10M5 5.5h6v5H5z',
  'align-center': 'M8 3v2.5M8 10.5V13M5 5.5h6v5H5z',
  'align-right': 'M13.5 3v10M5 5.5h6v5H5z',
  close: 'M4.5 4.5l7 7M11.5 4.5l-7 7',
  sidebar: 'M4 3h8a1.5 1.5 0 0 1 1.5 1.5v7A1.5 1.5 0 0 1 12 13H4a1.5 1.5 0 0 1-1.5-1.5v-7A1.5 1.5 0 0 1 4 3zM6.5 3v10',
  preview: 'M1.5 8S3.8 3.5 8 3.5 14.5 8 14.5 8 12.2 12.5 8 12.5 1.5 8 1.5 8zM8 6.2a1.8 1.8 0 1 1 0 3.6 1.8 1.8 0 0 1 0-3.6z',
  style: 'M1.5 12.5 5 3.5l3.5 9M2.8 9.3h4.4M13.8 8.2v4.3M13.8 10.6a2 2 0 1 1-4 0 2 2 0 0 1 4 0z',
  export: 'M8 1.8v8M5.5 4.3 8 1.8l2.5 2.5M5.8 6.5H4.5v7h7v-7h-1.3',
} as const

export type IconName = keyof typeof ICONS
