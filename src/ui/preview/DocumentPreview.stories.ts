import type { Meta, StoryObj } from '@storybook/vue3-vite'
import DocumentPreview from './DocumentPreview.vue'

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
  '<figure><span class="missing-image">图片无法显示：实验装置</span></figure></section>',
  '<section class="chapter" data-chapter-id="b"><h2 class="chapter-heading"><span class="chapter-number">2</span>结论</h2><p>全文完。</p></section>',
].join('')

const meta = {
  title: 'UI/Preview/DocumentPreview',
  component: DocumentPreview,
  parameters: { layout: 'fullscreen' },
} satisfies Meta<typeof DocumentPreview>

export default meta
type Story = StoryObj<typeof meta>

export const Default: Story = {
  args: { html: sample, activeChapterId: null, toDisplayUrl: (path: string) => path },
}
