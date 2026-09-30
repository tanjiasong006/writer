import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DocumentPreview from './DocumentPreview.vue'
import { THEMES, defaultDocumentStyle, overrideStyle, resolveTheme } from '../../domain/document_style/document_style.ts'

/** 用内嵌 SVG 模拟项目中的图片（宽 480、高 200）。 */
const figureImage = `data:image/svg+xml,${encodeURIComponent(
  '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="200"><rect width="480" height="200" fill="#e5e7eb"/><text x="240" y="108" font-size="20" text-anchor="middle" fill="#374151">实验装置</text></svg>',
)}`

/** 与 Rust render::html 输出结构相同的示例，用于调试预览样式。 */
const sample = [
  '<h1 class="doc-title">示例论文</h1>',
  '<section class="chapter" data-chapter-id="a"><h2 class="chapter-heading"><span class="chapter-number">1</span>绪论</h2>',
  '<p>长文档写作需要<strong>清晰的结构</strong>与<em>稳定的输出</em>，也需要 <code>行内代码</code>。</p>',
  '<ul><li><p>章节组织</p></li><li><p>自动编号</p></li></ul>',
  '<blockquote><p>方法决定结果。</p></blockquote></section>',
  '<section class="chapter" data-chapter-id="a1"><h3 class="chapter-heading"><span class="chapter-number">1.1</span>研究背景</h3>',
  '<h4 class="body-heading">正文内的小标题</h4>',
  '<table><thead><tr><th>组别</th><th style="text-align:right">样本数</th></tr></thead>',
  '<tbody><tr><td>对照组</td><td style="text-align:right">30</td></tr><tr><td>实验组</td><td style="text-align:right">32</td></tr></tbody></table>',
  '<pre><code>print("hello")</code></pre>',
  '<figure data-size="original" data-align="center"><img data-writer-src="figure" alt="原始尺寸"><figcaption>原始尺寸（跟随主题）</figcaption></figure>',
  '<figure data-size="small" data-align="left"><img data-writer-src="figure" alt="小图靠左"><figcaption>小图靠左</figcaption></figure>',
  '<figure data-size="full" data-align="center"><img data-writer-src="figure" alt="通栏"><figcaption>通栏</figcaption></figure>',
  '<figure data-size="original" data-align="center"><span class="missing-image">图片无法显示：实验装置</span></figure></section>',
  '<section class="chapter" data-chapter-id="b"><h2 class="chapter-heading"><span class="chapter-number">2</span>结论</h2><p>全文完。</p></section>',
].join('')

const meta = {
  title: 'UI/Preview/DocumentPreview',
  component: DocumentPreview,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DocumentPreview>

export default meta
type Story = StoryObj<typeof meta>

const toDisplayUrl = (path: string) => (path === 'figure' ? figureImage : path)

/** 默认主题（书籍）。 */
export const Default: Story = {
  args: { html: sample, activeChapterId: null, toDisplayUrl },
}

/** 实际触发浏览器解码失败：块级 / 行内占位、图注及正常图片共同显示。 */
export const BrokenImages: Story = {
  args: {
    html: [
      '<h1 class="doc-title">图片加载失败</h1>',
      '<section class="chapter" data-chapter-id="a"><h2 class="chapter-heading"><span class="chapter-number">1</span>实验记录</h2>',
      '<p>正常图片：</p><figure data-size="small" data-align="center"><img data-writer-src="figure" alt="实验装置"><figcaption>实验装置</figcaption></figure>',
      '<p>损坏图片：</p><figure data-size="small" data-align="center"><img data-writer-src="broken" alt="损坏的实验装置"><figcaption>图注保留</figcaption></figure>',
      '<p>行内图片 <img data-writer-src="broken" alt="曲线">，正文继续显示。</p>',
      '<p>无替代文字：<img data-writer-src="broken" alt=""></p></section>',
    ].join(''),
    activeChapterId: null,
    toDisplayUrl: (path: string) => path === 'figure' ? figureImage : 'data:image/png;base64,AAAA',
  },
}

/** 技术文档主题：黑体、紧凑；与编辑器、Word、PDF 使用同一套语义样式。 */
export const TechnicalTheme: Story = {
  args: { html: sample, activeChapterId: null, toDisplayUrl, theme: THEMES.technical },
}

/** 在默认主题上调整：正文黑体 14 磅、2 倍行距。 */
export const Adjusted: Story = {
  args: {
    html: sample,
    activeChapterId: null,
    toDisplayUrl,
    theme: resolveTheme(overrideStyle(defaultDocumentStyle(), { bodyFont: 'sans', bodySize: 14, lineHeight: 2 })),
  },
}
