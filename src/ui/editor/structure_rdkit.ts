import initRDKit from '@rdkit/rdkit'
import wasmUrl from '@rdkit/rdkit/RDKit_minimal.wasm?url'

/** 浏览器从安装包中加载 WASM；Node 测试由 RDKit 从包目录读取。 */
export const rdkit = await initRDKit(import.meta.env.MODE === 'test' || import.meta.env.SSR ? {} : { locateFile: () => wasmUrl })
  .catch((error: unknown) => {
    console.error('化学结构式绘图库加载失败', error)
    return null
  })

/** 镜像 RDKit 生成的二维 V3000 坐标，并互换单键的实楔、虚楔，使立体构型不变。 */
function mirroredMolblock(block: string): string {
  let section = ''
  return block.split('\n').map((line) => {
    if (line.startsWith('M  V30 BEGIN ')) section = line.slice(13)
    if (line.startsWith('M  V30 END ')) section = ''
    if (section === 'ATOM') {
      return line.replace(/^(M  V30 \d+ \S+ )([\d.eE+-]+)/, (_, prefix, x) => prefix + String(-Number(x)))
    }
    if (section === 'BOND' && /^M  V30 \d+ 1 /.test(line)) {
      return line.replace(/\bCFG=([13])\b/, (_, direction) => direction === '1' ? 'CFG=3' : 'CFG=1')
    }
    return line
  }).join('\n')
}

export function moleculeSvg(smiles: string, rotate: number, flip: boolean, preview = false): string {
  if (!rdkit) throw new Error('化学结构式绘图库加载失败')
  const molecule = rdkit.get_mol(smiles)
  if (!molecule) throw new Error('无法识别这个分子')
  let mirrored = null
  try {
    molecule.set_new_coords(false)
    // 按主轴摆正二维坐标，比例为 1 以保留键长。
    molecule.normalize_depiction(1, 1)
    if (flip) {
      mirrored = rdkit.get_mol(mirroredMolblock(molecule.get_v3Kmolblock()), '{"removeHs":false}')
      if (!mirrored) throw new Error('无法翻转这个分子')
    }
    // 单分子预览按参考图的画布适配；正文与反应式保留统一键长。
    return (mirrored ?? molecule).get_svg_with_highlights(JSON.stringify({
      width: preview ? 320 : -1, height: preview ? 235 : -1, scalingFactor: 20, rotate: (rotate + 180) % 360,
      kekulize: true, bondLineWidth: 1.5, padding: 0.06, clearBackground: false,
      addStereoAnnotation: true, explicitMethyl: false,
    }))
  } finally {
    mirrored?.delete()
    molecule.delete()
  }
}
