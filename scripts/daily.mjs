#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// daily.mjs · Scayla — הריצה היומית של מכונת התוכן (הכל Google/Vertex, בלי Claude).
//
// צנרת:
//   1. idea-engine   — ממלא את topics.json ברעיונות טריים (grounding) לפני הכתיבה
//   2. writers ×N    — machine-vertex לכל אשכול: מחקר → כתיבה → QA → קאבר → פרסום
//   3. refresh       — מרענן נתונים במאמר הוותיק ביותר (grounding), בונה updatedDate
//   4. integrity     — ביקורת-שלמות על המאגר (התראה רק אם יש חריגות)
//
// הבנייה + הפריסה + git נעשים *אחרי* daily.mjs (ב-workflow), כדי ש-daily יישאר
// "מוח התוכן" בלבד. refresh/idea-engine עורכים קבצים במקום → חייבים לרוץ לפני commit.
//
// env: GOOGLE_SA, GCP_PROJECT (למנועי-Gemini) · TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID (דיווח)
//      RUN_IDEAS/RUN_REFRESH/RUN_AUDIT=0 לכיבוי שלב · CLUSTER_TIMEOUT_MIN, STAGE_TIMEOUT_MIN
// הרצה: node scripts/daily.mjs            → 4 אשכולות + כל השלבים
//        node scripts/daily.mjs geo-ai    → אשכול יחיד (שלבי-הלוואי עדיין רצים)
// ─────────────────────────────────────────────────────────────────────────────
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import { notify, articleLine } from './notify.mjs'

const HERE = dirname(fileURLToPath(import.meta.url))
const CLUSTERS = ['geo-ai', 'seo-shopify', 'ecommerce', 'guides']
const only = process.argv[2] && !process.argv[2].startsWith('--') ? [process.argv[2]] : CLUSTERS

const CLUSTER_TIMEOUT_MS = (Number(process.env.CLUSTER_TIMEOUT_MIN) || 8) * 60_000
const STAGE_TIMEOUT_MS = (Number(process.env.STAGE_TIMEOUT_MIN) || 6) * 60_000
const on = (k) => process.env[k] !== '0' && process.env[k] !== 'false'

// spawn גנרי שלוכד את שורת RESULT:{...} ומחזיר אותה מפורסרת. תהליך תקוע נהרג.
// לשלבי-הלוואי (idea/refresh/audit) מסירים TELEGRAM_* מה-env כדי שיישארו שקטים —
// daily שולח דיווח מאוחד אחד. best-effort: כשל שלב-לוואי לא מפיל את הריצה.
function runScript(script, args, { timeoutMs = STAGE_TIMEOUT_MS, silentChild = false } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env }
    if (silentChild) { delete env.TELEGRAM_BOT_TOKEN; delete env.TELEGRAM_CHAT_ID }
    const p = spawn('node', [join(HERE, script), ...args], { env })
    let out = '', done = false
    const finish = (r) => { if (done) return; done = true; clearTimeout(timer); resolve(r) }
    const timer = setTimeout(() => {
      try { p.kill('SIGKILL') } catch { /* already gone */ }
      console.error(`⏱ ${script}: killed after ${timeoutMs / 60000}m timeout`)
      finish({ status: 'error', reason: `timeout after ${timeoutMs / 60000}m` })
    }, timeoutMs)
    p.stdout.on('data', (d) => { out += d })
    p.stderr.on('data', (d) => process.stderr.write(d))
    p.on('close', () => {
      const m = out.match(/RESULT:(\{.*\})/)
      let r = { status: 'error', reason: 'no RESULT line' }
      if (m) { try { r = JSON.parse(m[1]) } catch { /* keep error */ } }
      finish(r)
    })
    p.on('error', (e) => finish({ status: 'error', reason: 'spawn failed: ' + String(e).slice(0, 120) }))
  })
}

// כמה נושאים לנסות פר-אשכול לפני ויתור. יעד: 4 מאמרים ליום — נושא שנפסל (כפילות/בטיחות-build)
// לא "הורג" את האשכול; מנסים את הנושא הבא (המכונה מסמנת את הנפסל כ-done ובוחרת חדש). ──
const MAX_TOPIC_ATTEMPTS = Math.max(1, parseInt(process.env.MAX_TOPIC_ATTEMPTS || '2', 10) || 2)
const runMachine = async (cluster) => {
  let r
  for (let attempt = 1; attempt <= MAX_TOPIC_ATTEMPTS; attempt++) {
    r = await runScript('machine-vertex.mjs', [cluster, '--publish'], { timeoutMs: CLUSTER_TIMEOUT_MS })
    r = r && r.cluster ? r : { ...r, cluster }
    // רק 'skipped' (כפילות-קרובה / YAML-שבור) מייצר 0 מאמרים → מנסים נושא אחר. published/banked/
    // shelved/error כבר "השתמשו" בנושא ואין טעם לחזור עליהם.
    if (r.status !== 'skipped') break
    if (attempt < MAX_TOPIC_ATTEMPTS) console.error(`↻ ${cluster}: ${r.reason || 'skipped'} — נושא הבא (ניסיון ${attempt + 1}/${MAX_TOPIC_ATTEMPTS})`)
  }
  return r
}

// ── 1. מנוע-רעיונות (best-effort) ──
let ideas = null
if (on('RUN_IDEAS')) {
  console.error('\n════════ idea-engine ════════')
  ideas = await runScript('idea-engine.mjs', [], { silentChild: true })
}

// ── 2. כותבים ──
const results = []
for (const c of only) {
  console.error(`\n════════ ${c} ════════`)
  results.push(await runMachine(c))
}

// ── 2b. רשת-ביטחון · משגר כל מאמר שנתקע כ-needsReview (מנגנון ישן / מקרי-קצה).
//    המכונה החדשה מתקנת-ומשגרת ולא יוצרת needsReview, אז זה בד"כ no-op מיידי. ──
let fixer = null
if (on('RUN_FIXER')) {
  console.error('\n════════ fixer (safety-net) ════════')
  fixer = await runScript('fixer.mjs', [], { timeoutMs: STAGE_TIMEOUT_MS, silentChild: true })
}

// ── 3. רענון המאמר הוותיק ביותר (best-effort) ──
let refresh = null
if (on('RUN_REFRESH')) {
  console.error('\n════════ refresh ════════')
  refresh = await runScript('refresh.mjs', [], { timeoutMs: STAGE_TIMEOUT_MS, silentChild: true })
}

// ── 4. ביקורת-שלמות (best-effort) ──
let integrity = null
if (on('RUN_AUDIT')) {
  console.error('\n════════ integrity-audit ════════')
  integrity = await runScript('integrity-audit.mjs', [], { timeoutMs: 2 * 60_000, silentChild: true })
}

// ── דיווח מאוחד אחד לטלגרם ──
const published = results.filter((r) => r.status === 'published').length
const banked = results.filter((r) => r.status === 'banked').length
const shelved = results.filter((r) => r.status === 'shelved').length
const skipped = results.filter((r) => r.status === 'skipped').length
const errored = results.filter((r) => r.status === 'error').length

const lines = [`🏭 <b>מכונת התוכן · ריצה יומית</b>`]
if (ideas) lines.push(ideas.status === 'ok'
  ? `💡 רעיונות: +${ideas.added || 0} חדשים · מאגר ${ideas.totalTopics || '?'}`
  : `💡 רעיונות: ⚠️ ${String(ideas.reason || 'נכשל').slice(0, 60)}`)
lines.push(`📝 ${published} עלו · ${banked} למאגר · ${shelved} נגנזו · ${skipped} נפסלו · ${errored} שגיאות`)
const body = results.map(articleLine).filter(Boolean).join('\n')
if (body) lines.push('', body)
// מאמרים שנגנזו (לא עברו QA אחרי כל סבבי-התיקון המסלימים) · דיווח מפורש לליאור עם הסיבה.
const shelvedBody = results.filter((r) => r.status === 'shelved').map((r) => `⛔ ${r.title || r.slug} — ${r.shelveReason || 'לא עבר QA'}`).join('\n')
if (shelvedBody) lines.push('', shelvedBody)
if (refresh) lines.push('', refresh.status === 'refreshed'
  ? `♻️ רענון: ${refresh.changes} נתונים · ${refresh.title || refresh.slug}`
  : refresh.status === 'verified'
    ? `✅ רענון: אומת ואין מה לעדכן · ${refresh.title || refresh.slug}`
    : `♻️ רענון: ⚠️ ${String(refresh.reason || 'נכשל').slice(0, 60)}`)
if (fixer && fixer.status === 'ok' && fixer.fixed > 0) lines.push(`🛠 תיקונים: ${fixer.fixed} מאמר(ים) שנתקעו שוגרו לאוויר`)
if (integrity) lines.push(integrity.ok === false
  ? `🛡 תקינות: ⚠️ שגיאת-ריצה`
  : (integrity.totalViolations > 0
    ? `🛡 תקינות: ⚠️ ${integrity.totalViolations} חריגות`
    : `🛡 תקינות: ✓ נקי (${integrity.bank?.published ?? '?'} פורסמו)`))

await notify(lines.join('\n'))

// JSON מסכם ל-stdout (ה-workflow קורא כדי להחליט אם לפרוס).
console.log('DAILY_SUMMARY:' + JSON.stringify({ published, banked, shelved, skipped, errored, results, ideas, fixer, refresh, integrity }))
process.exit(errored === results.length && results.length > 0 ? 1 : 0)
