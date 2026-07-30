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
    // slug חייב להיות lowercase · Astro's content loader ממפה את ה-route ל-slug
    // באותיות קטנות, אז כותרת עם "AI" גדול נבנתה כ-/magazine/…-ai-… (הגרסה הגדולה 404).
    out.push({ slug: f.replace(/\.md$/, '').toLowerCase(), title: g('title'), description: g('description'), cluster: g('cluster'), body })
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

// ── llms-full.txt · תקציר עשיר של כל המאמרים ──
// הקובץ המלא חצה ~1MB וגדל עם כל מאמר יומי · fetchers של סוכני-AI חותכים בשקט
// באמצע, אז המאמרים האחרונים פשוט נעלמים. עדיף קיצוץ מכוון בגבול פסקה + קישור
// למאמר המלא, מאשר חיתוך שרירותי אצל הצרכן.
const BODY_CAP = 3500
function capBody(body, url) {
  if (body.length <= BODY_CAP) return body
  const cut = body.lastIndexOf('\n\n', BODY_CAP) // גבול פסקה אחרון בתוך התקרה
  const head = body.slice(0, cut > 0 ? cut : BODY_CAP).trim()
  return `${head}\n\n[המאמר המלא: ${url}]`
}

let full = `# Scayla · llms-full.txt\n> תקצירי מאמרי המגזין, לסוכני-AI. עודכן אוטומטית. לכל מאמר מצורף קישור לגרסה המלאה.\n\n`
for (const c of CLUSTER_ORDER) {
  for (const a of byCluster(c)) {
    const url = `${SITE}/magazine/${encodeURI(a.slug)}`
    full += `\n\n=====================================================================\n`
    full += `# ${a.title}\nURL: ${url}\nאשכול: ${a.cluster}\n\n${capBody(a.body, url)}\n`
  }
}
writeFileSync(LLMS_FULL, full)

console.log(`✓ llms.txt + llms-full.txt · ${arts.length} מאמרים מפורסמים`)
