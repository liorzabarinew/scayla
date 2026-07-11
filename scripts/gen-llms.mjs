#!/usr/bin/env node
// gen-llms.mjs · מייצר את בלוק-המאמרים ב-public/llms.txt (אינדקס לסוכני-AI) ואת
// public/llms-full.txt (הטקסט המלא של כל המאמרים המפורסמים). רץ ב-prebuild, אידמפוטנטי.
// אין API — קריאת קבצים בלבד.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ARTICLES_DIR = join(ROOT, 'src/content/magazine')
const LLMS = join(ROOT, 'public/llms.txt')
const LLMS_FULL = join(ROOT, 'public/llms-full.txt')
const SITE = 'https://scayla.co.il'
const START = '<!-- AUTO:articles:start -->'
const END = '<!-- AUTO:articles:end -->'

const CLUSTER_ORDER = ['GEO ואופטימיזציה למנועי AI', 'SEO לחנויות שופיפיי', 'שיווק לאיקומרס ישראלי', 'מדריכים וכלים']

function readArticles() {
  if (!existsSync(ARTICLES_DIR)) return []
  const out = []
  for (const f of readdirSync(ARTICLES_DIR)) {
    if (!f.endsWith('.md')) continue
    const raw = readFileSync(join(ARTICLES_DIR, f), 'utf8')
    const fm = (raw.match(/^---\n([\s\S]*?)\n---/) || [])[1] || ''
    const g = (k) => (fm.match(new RegExp(`^${k}:\\s*["']?(.+?)["']?\\s*$`, 'm')) || [])[1] || ''
    if (/^draft:\s*true/m.test(fm) || /^needsReview:\s*true/m.test(fm)) continue
    const body = raw.replace(/^---[\s\S]*?\n---\n?/, '').replace(/\n{3,}/g, '\n\n').trim()
    out.push({ slug: f.replace(/\.md$/, ''), title: g('title'), description: g('description'), cluster: g('cluster'), body })
  }
  return out
}

const arts = readArticles()
const byCluster = (c) => arts.filter((a) => a.cluster === c)

// ── llms.txt · בלוק אינדקס ממותג לפי אשכול ──
let block = `${START}\n## מאמרים במגזין\n`
for (const c of CLUSTER_ORDER) {
  const list = byCluster(c)
  if (!list.length) continue
  block += `\n### ${c}\n`
  for (const a of list) block += `- [${a.title}](${SITE}/magazine/${encodeURI(a.slug)}): ${a.description}\n`
}
block += END

let llms = existsSync(LLMS) ? readFileSync(LLMS, 'utf8') : '# Scayla\n'
llms = llms.replace(new RegExp(`\\n*${START}[\\s\\S]*?${END}\\n*`), '\n') // הסר בלוק ישן
llms = llms.replace(/\s*$/, '') + '\n\n' + block + '\n'
writeFileSync(LLMS, llms)

// ── llms-full.txt · הטקסט המלא של כל המאמרים ──
let full = `# Scayla · llms-full.txt\n> הטקסט המלא של מאמרי המגזין, לסוכני-AI. עודכן אוטומטית.\n\n`
for (const c of CLUSTER_ORDER) {
  for (const a of byCluster(c)) {
    full += `\n\n=====================================================================\n`
    full += `# ${a.title}\nURL: ${SITE}/magazine/${encodeURI(a.slug)}\nאשכול: ${a.cluster}\n\n${a.body}\n`
  }
}
writeFileSync(LLMS_FULL, full)

console.log(`✓ llms.txt + llms-full.txt · ${arts.length} מאמרים מפורסמים`)
