#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// idea-engine.mjs — מנוע-רעיונות אדפטיבי למכונת התוכן של Scayla (Gemini 2.5 Pro + Google Search).
//
// מה זה עושה:
//   לכל אחד מ-4 האשכולות, מריץ סריקה מבוססת-grounding: מה בעלי חנויות Shopify
//   ואנשי SEO/GEO בישראל מחפשים *עכשיו*, מה מתחרים/PAA/טרנדים מעלים, ומה עדיין
//   *לא מכוסה* אצלנו (קורא כותרות מאמרים קיימים + topics.json + topics-done.json).
//   מייצר topic-objects חדשים {cluster, keyword, title, intent}, מסנן כפילויות,
//   ומצרף אותם ל-topics.json (עם prune כשעוברים ~120). מדפיס RESULT ושולח סיכום לטלגרם.
//
//   רק Google/Vertex. אין Claude, אין API חיצוני שאינו של Google. אידמפוטנטי, בטוח להריץ יומית
//   לפני המכונה עצמה.
//
// env: GOOGLE_SA (או fallback: .secrets/sa.json), GCP_PROJECT(=scayla-prod),
//      GCP_REGION(=us-central1), GEMINI_MODEL(=gemini-2.5-pro), IDEAS_PER_CLUSTER, TOPICS_CAP
// הרצה: GOOGLE_SA="$(cat .secrets/sa.json)" GCP_PROJECT=scayla-prod node scripts/idea-engine.mjs [cluster-slug]
// ──────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { notify } from './notify.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ARTICLES_DIR = join(ROOT, 'src/content/magazine')
const TOPICS_FILE = join(ROOT, 'scripts/topics.json')
const DONE_FILE = join(ROOT, 'scripts/topics-done.json')

// ── SA: מ-env GOOGLE_SA, אחרת קריאה מ-.secrets/sa.json ──
const SA = process.env.GOOGLE_SA || (existsSync(join(ROOT, '.secrets/sa.json')) ? readFileSync(join(ROOT, '.secrets/sa.json'), 'utf8') : '')
if (!SA) { console.error('GOOGLE_SA (or .secrets/sa.json) is required'); process.exit(1) }
let _sa
try { _sa = JSON.parse(SA) } catch (e) { console.error('GOOGLE_SA is not valid JSON:', String(e).slice(0, 120)); process.exit(1) }
const PROJECT = process.env.GCP_PROJECT || _sa.project_id
if (!PROJECT) { console.error('GCP_PROJECT (or SA.project_id) is required'); process.exit(1) }
const REGION = process.env.GCP_REGION || 'us-central1'
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro'
const IDEAS_PER_CLUSTER = Math.max(1, parseInt(process.env.IDEAS_PER_CLUSTER || '5', 10) || 5)
const TOPICS_CAP = Math.max(20, parseInt(process.env.TOPICS_CAP || '120', 10) || 120)

// משוכפל מ-machine-vertex.mjs / content.config.ts — הסקריפט עצמאי.
const CLUSTERS = [
  { slug: 'geo-ai', title: 'GEO ואופטימיזציה למנועי AI', focus: 'איך נכנסים לתשובות של ChatGPT, Gemini, Perplexity ו-Claude · תוכן ציטוטבילי, נתונים מובנים, מדידת נראות ב-AI' },
  { slug: 'seo-shopify', title: 'SEO לחנויות שופיפיי', focus: 'קידום אורגני בגוגל לחנות Shopify · דפי מוצר, קטגוריות, מהירות, סכמות, קישור פנימי, תיקוני 301' },
  { slug: 'ecommerce', title: 'שיווק לאיקומרס ישראלי', focus: 'שיווק אורגני לחנות איקומרס ישראלית · תנועה בלי לשלם על כל קליק, המרה, תוכן שמוכר, עברית שמדורגת' },
  { slug: 'guides', title: 'מדריכים וכלים', focus: 'מדריכים מעשיים צעד-אחר-צעד · מחקר מילות מפתח, כלים, תהליכי עבודה למותגי איקומרס' },
]
const CLUSTER_BY_SLUG = Object.fromEntries(CLUSTERS.map((c) => [c.slug, c]))
const CLUSTER_BY_TITLE = Object.fromEntries(CLUSTERS.map((c) => [c.title, c]))
const VALID_INTENTS = new Set(['informational', 'commercial', 'transactional', 'navigational'])

function result(obj) { console.log('RESULT:' + JSON.stringify(obj)) }

// ── Google auth (SA JWT → access token), ללא תלות חיצונית ──
const b64url = (b) => Buffer.from(b).toString('base64url')
let _token = null
async function getToken() {
  if (_token) return _token
  const sa = _sa
  const iat = Math.floor(Date.now() / 1000)
  const unsigned =
    b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' })) + '.' +
    b64url(JSON.stringify({ iss: sa.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat, exp: iat + 3600 }))
  const sig = crypto.sign('RSA-SHA256', Buffer.from(unsigned), sa.private_key)
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: `grant_type=${encodeURIComponent('urn:ietf:params:oauth:grant-type:jwt-bearer')}&assertion=${unsigned}.${b64url(sig)}`,
  })
  const j = await res.json()
  if (!j.access_token) throw new Error('google token: ' + JSON.stringify(j).slice(0, 200))
  _token = j.access_token
  return _token
}

// endpoint פר-מודל/אזור. region==='global' → host גלובלי (gemini-2.5-flash זמין שם, 404 ב-us-central1).
const endpointFor = (model, region) => region === 'global'
  ? `https://aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/global/publishers/google/models/${model}:generateContent`
  : `https://${region}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${region}/publishers/google/models/${model}:generateContent`

// fetch עם timeout (AbortController) — כל קריאת-רשת חסומה נהרגת, לא תוקעת את הריצה.
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
async function fetchTimeout(url, opts = {}, timeoutMs = 90_000) {
  const ac = new AbortController()
  const t = setTimeout(() => ac.abort(), timeoutMs)
  try { return await fetch(url, { ...opts, signal: ac.signal }) }
  finally { clearTimeout(t) }
}
async function postJSONRetry(url, headers, body, { timeoutMs = 90_000, retries = 2 } = {}) {
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    try {
      const res = await fetchTimeout(url, { method: 'POST', headers, body: JSON.stringify(body) }, timeoutMs)
      if ((res.status === 429 || res.status >= 500) && attempt < retries) { lastErr = new Error('HTTP ' + res.status); await sleep(1500 * (attempt + 1)); continue }
      return await res.json()
    } catch (e) {
      lastErr = e
      if (attempt < retries) { await sleep(1500 * (attempt + 1)); continue }
      throw e
    }
  }
  throw lastErr
}

let CALLS = 0
async function callGemini(prompt, { search = false, maxTokens = 8000, temperature = 0.8, model = MODEL, region = REGION } = {}) {
  CALLS++
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature },
    ...(search ? { tools: [{ googleSearch: {} }] } : {}),
  }
  const j = await postJSONRetry(endpointFor(model, region), { authorization: `Bearer ${await getToken()}`, 'content-type': 'application/json' }, body, { timeoutMs: 120_000, retries: 2 })
  if (j.error) throw new Error(`gemini ${j.error.code || ''}: ${j.error.message || JSON.stringify(j).slice(0, 200)}`)
  const cand = j.candidates?.[0]
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim()
  const gm = cand?.groundingMetadata || {}
  const sources = (gm.groundingChunks || [])
    .map((c) => ({ title: (c.web?.title || '').replace(/"/g, "'"), url: c.web?.uri || '' })).filter((s) => s.url)
  return { text, sources }
}

// ── מצאי קיים (למניעת כפילויות) ──
function scanArticleTitles() {
  const byCluster = {}
  const all = []
  for (const c of CLUSTERS) byCluster[c.slug] = []
  if (existsSync(ARTICLES_DIR)) {
    for (const f of readdirSync(ARTICLES_DIR)) {
      if (!f.endsWith('.md')) continue
      const txt = readFileSync(join(ARTICLES_DIR, f), 'utf8')
      const title = (txt.match(/^title:\s*["']?(.+?)["']?\s*$/m) || [])[1] || ''
      const clusterTitle = (txt.match(/^cluster:\s*["']?(.+?)["']?\s*$/m) || [])[1] || ''
      const c = CLUSTER_BY_TITLE[clusterTitle]
      if (title) { all.push(title); if (c) byCluster[c.slug].push(title) }
    }
  }
  return { byCluster, all }
}

function loadTopics() {
  if (!existsSync(TOPICS_FILE)) return []
  try { const t = JSON.parse(readFileSync(TOPICS_FILE, 'utf8')); return Array.isArray(t) ? t : [] }
  catch (e) { console.error('topics.json parse error:', String(e).slice(0, 160)); return [] }
}
function loadDone() {
  try { return existsSync(DONE_FILE) ? new Set(JSON.parse(readFileSync(DONE_FILE, 'utf8'))) : new Set() } catch { return new Set() }
}

// נירמול מפתח להשוואת-כפילויות (case-fold, רווחים, פיסוק-קצה) — עברית+לטינית.
const normKey = (s) => String(s || '').toLowerCase().replace(/[‘’'"“”]/g, '').replace(/\s+/g, ' ').trim()

// ── פרסור הפלט של Gemini לרעיונות ──
// מבקשים שורות בפורמט: KEYWORD | TITLE | INTENT   (אחד לשורה, בלי JSON — יציב מול grounding)
function parseIdeas(text, clusterSlug) {
  const out = []
  for (const raw of String(text).split('\n')) {
    const line = raw.trim()
    if (!line || line.startsWith('#') || line.startsWith('//')) continue
    // מסירים בוליט/מספור מוביל
    const clean = line.replace(/^[-*•\d.)\s]+/, '').trim()
    if (!clean.includes('|')) continue
    const parts = clean.split('|').map((p) => p.trim())
    if (parts.length < 2) continue
    let [keyword, title, intent] = parts
    if (!keyword || !title) continue
    if (keyword.length > 90 || title.length > 160) continue // מסנן שורות-זבל/משפטים ארוכים
    intent = (intent || '').toLowerCase()
    if (!VALID_INTENTS.has(intent)) intent = 'informational'
    out.push({ cluster: clusterSlug, keyword, title, intent })
  }
  return out
}

const scanPrompt = (cat, existingTitles, existingKeywords, today) => {
  const titles = existingTitles.slice(0, 80)
  const kws = existingKeywords.slice(0, 200)
  return `אתה חוקר-תוכן בכיר למגזין של "Scayla" — אפליקציית SEO/GEO ל-Shopify שמקדמת חנויות אונליין בגוגל וגם במנועי-התשובות של ה-AI (ChatGPT, Gemini, Perplexity, Claude). הקהל: בעלי חנויות Shopify ואנשי שיווק בישראל. התאריך היום: ${today}.

המשימה: השתמש בחיפוש Google כדי לזהות **פערי-תוכן טריים** באשכול הבא, ולהציע ${IDEAS_PER_CLUSTER + 3} רעיונות למאמרים חדשים שאין לנו עדיין.
אשכול: ${cat.title}
מיקוד: ${cat.focus}

חקור מה קורה *עכשיו*:
- מה בעלי חנויות Shopify ואנשי SEO/GEO בישראל מחפשים בגוגל בתקופה האחרונה (מונחי-לונג-טייל, שאלות "איך/כמה/מתי/למה").
- שאלות People-Also-Ask ונושאים שמתחרים/בלוגים מקצועיים העלו לאחרונה.
- טרנדים/עדכונים חדשים (עדכוני Google, פיצ'רים חדשים ב-Shopify, שינויים ב-AI Overviews / ChatGPT / Perplexity) שעדיין לא כיסינו.

**חובה: הימנע מכל נושא שכבר קיים אצלנו.** אלה הכותרות שכבר במגזין:
${titles.length ? titles.map((t) => `  • ${t}`).join('\n') : '  (אין עדיין)'}

ואלה מילות-המפתח שכבר בתוכנית/נעשו (אל תחזור עליהן ואל תבחר וריאציה כמעט-זהה):
${kws.length ? kws.map((k) => `  • ${k}`).join('\n') : '  (אין עדיין)'}

החזר **בדיוק** ${IDEAS_PER_CLUSTER + 3} שורות, שורה לרעיון, בפורמט המדויק (מופרד ב-|), בלי טקסט מקדים או מסכם ובלי JSON:
KEYWORD | TITLE | INTENT

- KEYWORD: ביטוי-חיפוש קצר בעברית (2-6 מילים) שבן-אדם באמת מקליד בגוגל. ייחודי, לא חופף לרשימות למעלה.
- TITLE: כותרת-מאמר ממגנטת ומדויקת בעברית (עד ~12 מילים). אם שנה הכרחית — רק ${today.slice(0, 4)}, ועדיף על-זמני.
- INTENT: אחד מ: informational | commercial | transactional | navigational.

רק רעיונות אמיתיים שנתמכים במה שמצאת בחיפוש. בלי המצאות, בלי כותרות קלישאתיות ריקות.`
}

async function main() {
  const only = process.argv.find((a) => CLUSTER_BY_SLUG[a]) // אופציונלי: הרצת אשכול בודד
  const targets = only ? [CLUSTER_BY_SLUG[only]] : CLUSTERS
  const today = new Date().toISOString().slice(0, 10)

  const { byCluster: titlesByCluster, all: allTitles } = scanArticleTitles()
  let topics = loadTopics()
  const done = loadDone()

  // סט-כפילויות: כל מילות-המפתח הקיימות (topics.json + topics-done.json) מנורמלות.
  const seenKeys = new Set([...topics.map((t) => normKey(t && t.keyword)), ...[...done].map(normKey)].filter(Boolean))
  const seenTitles = new Set([...topics.map((t) => normKey(t && t.title)), ...allTitles.map(normKey)].filter(Boolean))

  const perCluster = {}
  const added = []
  const errors = []

  for (const cat of targets) {
    perCluster[cat.slug] = 0
    // רשימות למניעת-כפילות שנשלחות למודל: כותרות קיימות + מילות-מפתח קיימות (גלובלי, לא רק האשכול).
    const existingTitles = [...titlesByCluster[cat.slug], ...topics.filter((t) => t && t.cluster === cat.slug).map((t) => t.title).filter(Boolean)]
    const existingKeywords = topics.map((t) => t && t.keyword).filter(Boolean)
    try {
      const { text } = await callGemini(scanPrompt(cat, existingTitles, existingKeywords, today), { search: true, maxTokens: 4000, temperature: 0.85 })
      const ideas = parseIdeas(text, cat.slug)
      for (const idea of ideas) {
        if (perCluster[cat.slug] >= IDEAS_PER_CLUSTER) break
        const kNorm = normKey(idea.keyword)
        const tNorm = normKey(idea.title)
        if (!kNorm || seenKeys.has(kNorm) || seenTitles.has(tNorm)) continue
        seenKeys.add(kNorm)
        seenTitles.add(tNorm)
        topics.push(idea)
        added.push(idea)
        perCluster[cat.slug]++
      }
    } catch (e) {
      const msg = String(e).slice(0, 160)
      console.error(`[${cat.slug}] scan failed:`, msg)
      errors.push(`${cat.slug}: ${msg}`)
    }
  }

  // ── prune: אם עברנו את ה-cap, גוזמים את *הישנים ביותר שלא-טופלו* (מתחילת הקובץ), משמרים done ורעיונות-חדשים ──
  let pruned = 0
  if (topics.length > TOPICS_CAP) {
    const overflow = topics.length - TOPICS_CAP
    const addedSet = new Set(added) // רעיונות שנוספו עכשיו — לא לגזום
    const kept = []
    let toDrop = overflow
    for (const t of topics) {
      const isDone = t && done.has(t.keyword)
      const isNew = addedSet.has(t)
      if (toDrop > 0 && !isDone && !isNew) { toDrop--; pruned++; continue } // גוזם ישן-ושלא-טופל
      kept.push(t)
    }
    topics = kept
  }

  // כתיבה רק אם השתנה משהו (אידמפוטנטי — ריצה חוזרת בלי רעיונות חדשים לא נוגעת בקובץ).
  const changed = added.length > 0 || pruned > 0
  if (changed) writeFileSync(TOPICS_FILE, JSON.stringify(topics, null, 2) + '\n')

  const perClusterStr = CLUSTERS.map((c) => `${c.slug}:${perCluster[c.slug] || 0}`).join(' ')
  console.log(`נוספו ${added.length} נושאים חדשים · ${perClusterStr} · נגזמו ${pruned} · סה"כ topics.json=${topics.length} · קריאות=${CALLS}`)
  for (const c of targets) console.log(`  ${c.slug} (${c.title}): +${perCluster[c.slug] || 0}`)

  // סיכום טלגרם קצר (no-op בלי TELEGRAM_*).
  const summary = added.length
    ? `💡 מנוע-רעיונות Scayla · +${added.length} נושאים חדשים\n${targets.map((c) => `• ${c.title}: +${perCluster[c.slug] || 0}`).join('\n')}\nסה"כ בתוכנית: ${topics.length}${pruned ? ` · נגזמו ${pruned} ישנים` : ''}${errors.length ? `\n⚠️ שגיאות: ${errors.length}` : ''}`
    : `💡 מנוע-רעיונות Scayla · לא נמצאו נושאים חדשים (הכל מכוסה)${errors.length ? `\n⚠️ שגיאות: ${errors.length}` : ''}`
  await notify(summary)

  result({
    status: errors.length && !added.length ? 'error' : 'ok',
    added: added.length,
    perCluster,
    pruned,
    totalTopics: topics.length,
    calls: CALLS,
    errors,
    newTopics: added,
  })

  // exit non-zero רק על כישלון קשה: כל האשכולות נכשלו ושום דבר לא נוסף.
  if (errors.length === targets.length && added.length === 0) process.exit(1)
}

main().catch(async (e) => {
  const msg = String(e && e.stack ? e.stack : e).slice(0, 300)
  console.error('idea-engine fatal:', msg)
  try { await notify(`⚠️ מנוע-רעיונות Scayla נכשל: ${String(e).slice(0, 160)}`) } catch {}
  result({ status: 'error', reason: String(e).slice(0, 200) })
  process.exit(1)
})
