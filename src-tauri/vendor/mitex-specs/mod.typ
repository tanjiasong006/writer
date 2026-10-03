// Writer：mitex 0.2.4 specs/mod.typ 的精简版，只组成 mitex-scope（不输出 metadata）。
#import "prelude.typ": *
#import "latex/standard.typ": package as latex-std

#let packages = (latex-std,)

// Writer：mitex 0.2.4 按 Typst 0.11 的符号名转换，这些名称在 Typst 0.15 中已改名，补上兼容的定义。
#let writer-compat = (
  diff: std.sym.partial,
  angle: std.symbol("∠", ("l", "⟨"), ("r", "⟩"), ("l.double", "⟪"), ("r.double", "⟫")),
  planck: std.symbol("ℎ", ("reduce", "ℏ")),
  sect: std.symbol("∩", ("big", "⋂"), ("double", "⋒"), ("sq", "⊓"), ("sq.big", "⨅"), ("dot", "⩀")),
)

#let mitex-scope = packages.map(pkg => pkg.scope).sum() + writer-compat
