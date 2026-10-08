"""
由 fetch.sh 下载的 wikidata.tsv 生成扩展分子库 src/ui/editor/molecules_extended.json（docs/decisions.md 第 22 节）。

依赖见 requirements.txt：python3 -m venv .venv && .venv/bin/pip install -r requirements.txt && .venv/bin/python build.py

- 只保留单个分子（不含盐、配合物、水合物）、2～80 个重原子、只有常见非金属元素、没有同位素与自由基、中文名称中有汉字的化合物。
- SMILES 转成凯库勒式（与核心库相同），保留立体构型；中文名称转成简体（含台湾用词）。
- 结构相同的条目合并；只差立体构型时，未标立体构型的条目并入唯一一个标了的条目。
- 核心库（structure_library.ts 中的 MOLECULES）优先：与核心库中的分子骨架相同的条目去掉，名称与核心库相同的去掉该名称。
- 按 Wikidata 站点链接数（知名程度）排序。每个名称附拼音首字母（汉字取首字母，字母与数字保留，其他忽略）；
  核心库的名称也在这里算好（core）。
"""
import collections, json, re, sys
from pathlib import Path

import opencc
from pypinyin import Style, lazy_pinyin
from rdkit import Chem, RDLogger

RDLogger.DisableLog('rdApp.*')
HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
CORE_TS = ROOT / 'src/ui/editor/structure_library.ts'
OUTPUT = ROOT / 'src/ui/editor/molecules_extended.json'
MAX_HEAVY = 80
ELEMENTS = set('C H N O S P F Cl Br I B Si Se'.split())
# 显示名称的来源：先是标签再是别名，各按简体、通用、繁体的顺序。
LANGS = ['zh-cn', 'zh-hans', 'zh', 'zh-sg', 'zh-my', 'zh-hant', 'zh-tw', 'zh-hk', 'zh-mo']
HAN = re.compile(r'[㐀-鿿]')
to_simplified = opencc.OpenCC('tw2sp')


def literal(value: str) -> str:
    match = re.match(r'^"(.*)"(@[\w-]+)?$', value)
    return match.group(1).replace('\\"', '"') if match else value


def initials(name: str) -> str:
    result = []
    for part in lazy_pinyin(name, style=Style.FIRST_LETTER, errors=lambda chars: [chars]):
        result.append(re.sub(r'[^a-z0-9]', '', part.lower()))
    return ''.join(result)


def skeleton(smiles: str) -> str | None:
    """不含立体构型的规范 SMILES，用于比较是否同一骨架。"""
    mol = Chem.MolFromSmiles(smiles)
    return Chem.MolToSmiles(mol, isomericSmiles=False) if mol else None


def clean(smiles: str) -> tuple[str | None, str]:
    """（凯库勒式 SMILES，剔除原因）"""
    mol = Chem.MolFromSmiles(smiles)
    if mol is None: return None, 'SMILES 无法解析'
    if len(Chem.GetMolFrags(mol)) > 1: return None, '多组分'
    atoms = list(mol.GetAtoms())
    if len(atoms) <= 1: return None, '单原子'
    if len(atoms) > MAX_HEAVY: return None, '重原子过多'
    if any(atom.GetIsotope() for atom in atoms): return None, '同位素'
    if any(atom.GetSymbol() not in ELEMENTS for atom in atoms): return None, '金属或少见元素'
    if any(atom.GetNumRadicalElectrons() for atom in atoms): return None, '自由基'
    try:
        Chem.Kekulize(mol, clearAromaticFlags=True)
    except Exception:
        return None, '无法转为凯库勒式'
    return Chem.MolToSmiles(mol, kekuleSmiles=True, isomericSmiles=True), ''


def has_stereo(smiles: str) -> bool:
    return '@' in smiles or '/' in smiles or '\\' in smiles


def read_core() -> list[tuple[list[str], str]]:
    source = CORE_TS.read_text(encoding='utf-8')
    return [(re.findall(r"'([^']*)'", names), smiles) for names, smiles in re.findall(r"names: \[([^\]]*)\].*?smiles: '([^']*)'", source)]


def read_items(path: Path) -> dict:
    items: dict = {}
    with path.open(encoding='utf-8') as file:
        next(file)
        for line in file:
            cols = line.rstrip('\n').split('\t')
            if len(cols) != 7: continue
            entity, kind, lang, label, canon, iso, links = (literal(col) for col in cols)
            item = items.setdefault(entity, {'zh': [], 'en': [], 'smiles': set(), 'links': 0})
            item['smiles'].add(iso or canon)
            item['links'] = max(item['links'], int(links or 0))
            label = label.strip()
            if lang == 'en':
                item['en'].append((kind != 'label', label))
            elif HAN.search(label):
                rank = LANGS.index(lang) if lang in LANGS else len(LANGS)
                item['zh'].append((kind != 'label', rank, to_simplified.convert(label)))
    return items


def main() -> None:
    items = read_items(HERE / 'wikidata.tsv')
    core = read_core()
    core_names = {name for names, _ in core for name in names}
    core_skeletons = {skeleton(smiles) for _, smiles in core}

    rejected = collections.Counter()
    by_smiles: dict[str, dict] = {}
    for item in items.values():
        # 一个条目有几个 SMILES 时取最短的（通常是未拆分的主要形式），结果与下载顺序无关。
        smiles, reason = clean(min(item['smiles'], key=lambda s: (len(s), s)))
        if smiles is None:
            rejected[reason] += 1
            continue
        names = [name for *_, name in sorted(item['zh'])]
        if not names:
            rejected['没有中文名称'] += 1
            continue
        entry = by_smiles.setdefault(smiles, {'names': [], 'english': [], 'links': 0})
        entry['names'] += names
        entry['english'] += [name for _, name in sorted(item['en'])]
        entry['links'] = max(entry['links'], item['links'])

    # 只差立体构型：未标立体构型的并入唯一一个标了的。
    groups = collections.defaultdict(list)
    for smiles in by_smiles:
        groups[skeleton(smiles)].append(smiles)
    for members in groups.values():
        marked = [smiles for smiles in members if has_stereo(smiles)]
        if len(marked) != 1: continue
        for smiles in members:
            if has_stereo(smiles): continue
            target, source = by_smiles[marked[0]], by_smiles.pop(smiles)
            target['names'] += source['names']
            target['english'] += source['english']
            target['links'] = max(target['links'], source['links'])

    molecules = []
    for smiles, entry in by_smiles.items():
        if skeleton(smiles) in core_skeletons:
            rejected['核心库中已有'] += 1
            continue
        names = [name for name in dict.fromkeys(entry['names']) if name not in core_names]
        if not names:
            rejected['名称都在核心库中'] += 1
            continue
        english = entry['english'][0] if entry['english'] else ''
        molecules.append((-entry['links'], names[0], names, english, smiles))
    molecules.sort()

    rows = [json.dumps([names, english, smiles, [initials(name) for name in names]], ensure_ascii=False, separators=(',', ':'))
            for _, _, names, english, smiles in molecules]
    core_initials = json.dumps({name: initials(name) for name in sorted(core_names)}, ensure_ascii=False, separators=(',', ':'))
    OUTPUT.write_text('{"core":' + core_initials + ',\n"molecules":[\n' + ',\n'.join(rows) + '\n]}\n', encoding='utf-8')

    name_count = collections.Counter(name for *_, names, _, _ in molecules for name in names)
    print(f'Wikidata 条目 {len(items)}，扩展库 {len(molecules)} 个分子，'
          f'带立体构型 {sum(has_stereo(m[4]) for m in molecules)}，一名多结构 {sum(1 for c in name_count.values() if c > 1)}')
    print('剔除：' + '，'.join(f'{reason} {count}' for reason, count in rejected.most_common()))
    print(f'{OUTPUT.relative_to(ROOT)}：{OUTPUT.stat().st_size / 1e6:.2f} MB')


if __name__ == '__main__':
    sys.exit(main())
