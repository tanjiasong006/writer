#!/usr/bin/env bash
# 发布一个新版本（docs/decisions.md 第 10 节）：改三处版本号并提交，推送 main 与标签 v<版本号>，
# 之后由 GitHub Actions 构建并自动发布。
# 用法：npm run release [-- 版本号]（或 scripts/release.sh [版本号]），不给版本号时把末位加一（0.1.4 → 0.1.5）。
set -euo pipefail

cd "$(dirname "$0")/.."

fail() {
  echo "错误：$*" >&2
  exit 1
}

[ "$(git branch --show-current)" = main ] || fail "只能在 main 上发布"
[ -z "$(git status --porcelain)" ] || fail "工作区有未提交的修改"
git fetch -q origin main --tags
[ -z "$(git log --oneline HEAD..origin/main)" ] || fail "本地 main 落后于 origin/main，先拉取"

current="$(node -p "require('./package.json').version")"
version="${1:-${current%.*}.$((${current##*.} + 1))}"
version="${version#v}"
tag="v$version"
[[ "$version" =~ ^[0-9]+\.[0-9]+\.[0-9]+$ ]] || fail "版本号应为 x.y.z：$version"
git rev-parse -q --verify "refs/tags/$tag" >/dev/null && fail "标签 $tag 已存在"

previous="$(git describe --tags --abbrev=0 --match 'v*' 2>/dev/null || true)"
echo "发布 $current → ${version}，${previous:-最初}以来的提交："
git log --no-merges --reverse --format='  %s' "${previous:+$previous..}HEAD"
echo
read -r -p "运行检查并发布？[y/N] " answer
[ "$answer" = y ] || [ "$answer" = Y ] || exit 1

npm run -s typecheck
npm test -s

npm version "$version" --no-git-tag-version >/dev/null
perl -0pi -e "s/^version = \"[^\"]*\"/version = \"$version\"/m" src-tauri/Cargo.toml
perl -0pi -e "s/\"version\": \"[^\"]*\"/\"version\": \"$version\"/" src-tauri/tauri.conf.json
(cd src-tauri && cargo update -p writer --offline -q)

git add package.json package-lock.json src-tauri/Cargo.toml src-tauri/Cargo.lock src-tauri/tauri.conf.json
git commit -q -F - <<EOF
chore: 发布 $tag
EOF
git tag "$tag"
git push -q origin main
git push -q origin "$tag"

echo "已推送 ${tag}，构建进度：gh run list --workflow release.yml --limit 1"
