#!/usr/bin/env bash
# 根据上一个版本标签到给定标签之间的提交生成更新说明（Markdown，输出到 stdout）。
# 用法：scripts/release-notes.sh v0.1.1
# feat → 新功能，fix → 修复，没有类型前缀的提交 → 改进；docs、build、refactor 等不面向用户的提交不列出。
set -euo pipefail

tag="$1"
previous="$(git describe --tags --abbrev=0 --match 'v*' "$tag^" 2>/dev/null || true)"
range="${previous:+$previous..}$tag"

features=()
fixes=()
improvements=()
while IFS= read -r subject; do
  if [[ "$subject" =~ ^([a-z]+)(\([^\)]*\))?!?:[[:space:]]*(.*)$ ]]; then
    case "${BASH_REMATCH[1]}" in
      feat) features+=("${BASH_REMATCH[3]}") ;;
      fix) fixes+=("${BASH_REMATCH[3]}") ;;
    esac
  else
    improvements+=("$subject")
  fi
done < <(git log --no-merges --reverse --format=%s "$range")

section() {
  local title="$1"
  shift
  [ "$#" -eq 0 ] && return
  printf '### %s\n\n' "$title"
  printf -- '- %s\n' "$@"
  printf '\n'
}

section 新功能 ${features[@]+"${features[@]}"}
section 改进 ${improvements[@]+"${improvements[@]}"}
section 修复 ${fixes[@]+"${fixes[@]}"}

cat <<'EOF'
### 安装

- **macOS**（Apple Silicon 与 Intel 通用）：下载 `.dmg`，把 Writer 拖进“应用程序”。第一次打开如果被拦下，
  到“系统设置 → 隐私与安全性”中点“仍要打开”。
- **Windows**：下载 `-setup.exe`（推荐）或 `.msi` 安装。

已安装的版本可以通过“帮助 → 检查更新…”直接更新。
EOF

if [ -n "$previous" ]; then
  printf '\n完整变更：https://github.com/%s/compare/%s...%s\n' "${GITHUB_REPOSITORY:-tanjiasong006/writer}" "$previous" "$tag"
fi
