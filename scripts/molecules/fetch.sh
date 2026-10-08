#!/bin/sh
# 下载 Wikidata（CC0）中有中文名称与 SMILES 的化合物，写到 scripts/molecules/wikidata.tsv（不提交）。
# 之后运行 build.py 生成扩展分子库（docs/decisions.md 第 22 节）。
set -e
cd "$(dirname "$0")"
curl -sSfL -m 600 -G https://qlever.cs.uni-freiburg.de/api/wikidata \
  -H 'Accept: text/tab-separated-values' \
  -o wikidata.tsv \
  --data-urlencode 'query=PREFIX wdt: <http://www.wikidata.org/prop/direct/>
PREFIX rdfs: <http://www.w3.org/2000/01/rdf-schema#>
PREFIX skos: <http://www.w3.org/2004/02/skos/core#>
PREFIX wikibase: <http://wikiba.se/ontology#>
SELECT ?c ?kind ?lang ?label ?canon ?iso ?links WHERE {
  { SELECT DISTINCT ?c WHERE { ?c wdt:P233 [] . { ?c rdfs:label ?z } UNION { ?c skos:altLabel ?z } FILTER(LANGMATCHES(LANG(?z), "zh")) } }
  ?c wdt:P233 ?canon .
  OPTIONAL { ?c wdt:P2017 ?iso }
  OPTIONAL { ?c wikibase:sitelinks ?links }
  { ?c rdfs:label ?label BIND("label" AS ?kind) } UNION { ?c skos:altLabel ?label BIND("alias" AS ?kind) }
  BIND(LANG(?label) AS ?lang)
  FILTER(LANGMATCHES(?lang, "zh") || ?lang = "en")
}'
wc -l wikidata.tsv
