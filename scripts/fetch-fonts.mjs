// 下载随应用打包的开源中文字体（SIL OFL 1.1，见 src-tauri/fonts/LICENSE-OFL.txt）到 src-tauri/fonts/。
// 字体体积大（约 80 MB），不提交到仓库；构建正式包前执行（tauri.conf.json 的 beforeBuildCommand），
// 已存在且校验一致的文件跳过。docs/decisions.md 第 6 节。
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const BASE = 'https://github.com/notofonts/noto-cjk/raw/main/'
const FONTS = [
  ['Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Regular.otf', '2a2eae2628df83556c54018c41e20fa532c1b862c5256ae8b3f23feb918d12ca'],
  ['Serif/OTF/SimplifiedChinese/NotoSerifCJKsc-Bold.otf', '8af07d4b6c2e82bcc72a30e066eaf295f11b9424f4aad2eaa9fe0e9c3b38fc73'],
  ['Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Regular.otf', '2c76254f6fc379fddfce0a7e84fb5385bb135d3e399294f6eeb6680d0365b74b'],
  ['Sans/OTF/SimplifiedChinese/NotoSansCJKsc-Bold.otf', 'b5f0d1a190a7f9b43c310a8850630af12553df32c4c050543f9059732d9b4c0a'],
]

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'src-tauri', 'fonts')
mkdirSync(dir, { recursive: true })
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex')

for (const [path, hash] of FONTS) {
  const target = join(dir, path.split('/').pop())
  if (existsSync(target) && sha256(readFileSync(target)) === hash) continue
  process.stdout.write(`下载 ${path}…\n`)
  const response = await fetch(BASE + path)
  if (!response.ok) throw new Error(`下载失败：${path}（${response.status}）`)
  const bytes = Buffer.from(await response.arrayBuffer())
  if (sha256(bytes) !== hash) throw new Error(`校验失败：${path}`)
  writeFileSync(target, bytes)
}
