#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// daily.mjs · Scayla — הריצה היומית של מכונת התוכן.
// לכל אחד מ-4 האשכולות: מריץ את machine-vertex (מחקר → כתיבה → QA → קאבר),
// אוסף את שורות ה-RESULT, ומדווח סיכום לטלגרם. הבנייה + הפריסה + git נעשים
// אחריו (ב-workflow / בסקריפט העוטף), כדי ש-daily.mjs יישאר "מוח התוכן" בלבד.
//
// env: GOOGLE_SA, GCP_PROJECT (למכונה) · TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (לדיווח)
// הרצה: node scripts/daily.mjs            → 4 אשכולות, מפרסם (--publish)
//        node scripts/daily.mjs geo-ai    → אשכול יחיד
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { notify, articleLine } from './notify.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLUSTERS = ['geo-ai', 'seo-shopify', 'ecommerce', 'guides']
const only = process.argv[2] && !process.argv[2].startsWith('--') ? [process.argv[2]] : CLUSTERS

// תקציב-זמן פר-אשכול (דקות) · תהליך תקוע נהרג ומחזיר error, כדי שלא יחסום את כל הריצה.
const CLUSTER_TIMEOUT_MS = (Number(process.env.CLUSTER_TIMEOUT_MIN) || 8) * 60_000

function runMachine(cluster) {
  return new Promise((resolve) => {
    const p = spawn('node', [join(HERE, 'machine-vertex.mjs'), cluster, '--publish'], { env: process.env })
    let out = '', err = '', done = false
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r) }
    const timer = setTimeout(() => {
      try { p.kill('SIGKILL') } catch { /* already gone */ }
      console.error(`⏱ ${cluster}: killed after ${CLUSTER_TIMEOUT_MS / 60000}m timeout`)
      finish({ status: 'error', cluster, reason: `timeout after ${CLUSTER_TIMEOUT_MS / 60000}m` })
    }, CLUSTER_TIMEOUT_MS)
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => { err += d; process.stderr.write(d) })
    p.on('close', () => {
      const m = out.match(/RESULT:(\{.*\})/)
      let r = { status: 'error', cluster, reason: 'no RESULT line' }
      if (m) { try { r = JSON.parse(m[1]) } catch { /* keep error */ } }
      finish(r)
    })
    p.on('error', (e) => finish({ status: 'error', cluster, reason: 'spawn failed: ' + String(e).slice(0, 120) }))
  })
}

const results = []
for (const c of only) {
  console.error(`\n════════ ${c} ════════`)
  results.push(await runMachine(c))
}

const published = results.filter((r) => r.status === 'published').length
const banked = results.filter((r) => r.status === 'banked').length
const skipped = results.filter((r) => r.status === 'skipped').length
const errored = results.filter((r) => r.status === 'error').length

const head = `🏭 <b>מכונת התוכן · ריצה יומית</b>\n${published} עלו · ${banked} למאגר · ${skipped} נפסלו · ${errored} שגיאות`
const body = results.map(articleLine).filter(Boolean).join('\n')
await notify(`${head}\n\n${body}`)

// מדפיס JSON מסכם ל-stdout (ה-workflow יכול לקרוא כדי להחליט אם לפרוס).
console.log('DAILY_SUMMARY:' + JSON.stringify({ published, banked, skipped, errored, results }))
process.exit(errored === results.length ? 1 : 0)
