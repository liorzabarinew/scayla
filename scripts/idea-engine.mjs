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
// ── שכבת הביקוש ─────────────────────────────────────────────────────────────
// Google Ads · KeywordPlanIdeaService.GenerateKeywordIdeas בלבד, קריאה בלבד.
// ה-MCC מחזיק ~13 חשבונות לקוח חיים; המודול לא יוצר, לא עורך ולא משהה כלום.
import { keywordIdeas } from '../lib/ads-keywords.mjs'
import { hasDemand } from '../lib/demand.mjs'

// כמה ביטויים אמיתיים להזרים לפרומפט. 25 מספיק כדי לתת למודל ממה לבחור
// בלי להטביע את שאר ההנחיות.
const REAL_TERMS_PER_CLUSTER = Math.max(0, parseInt(process.env.REAL_TERMS_PER_CLUSTER || '25', 10) || 0)
// תקרה. "chatgpt" עם 1.8 מיליון חיפושים הוא לא נושא · הוא ים שלא נשחה בו.
// מעל הסף הזה הביטוי כללי מדי מכדי שאתר בגודל שלנו ידורג עליו.
const MAX_HEAD_VOLUME = Math.max(0, parseInt(process.env.MAX_HEAD_VOLUME || '5000', 10) || 0)
// סף הכניסה. לא הועתק מ-Mr. Make (50) · שם השוק גדול יותר. נמדד מול ארבעת
// האשכולות שלנו, ומכוון דרך משתנה סביבה כדי שכיול לא ידרוש שינוי קוד.
const MIN_REAL_VOLUME = Math.max(0, parseInt(process.env.MIN_ADS_VOLUME || '30', 10) || 0)

// רלוונטיות לזרע · רשימה נפרדת מ-CLUSTER_SIGNALS בכוונה.
// CLUSTER_SIGNALS נבנה כדי להבחין *בין* האשכולות שלנו, וכולם עוסקים בשופיפיי —
// ולכן "שופיפיי" איננה שם, והשימוש בו כמסנן זרע פסל דווקא את הביטוי הכי
// מזוהה איתנו. רשימה למשימה שלה.
const SEED_RELEVANT = ['seo', 'geo', 'aeo', 'קידום', 'אורגני', 'גוגל', 'חיפוש', 'דירוג', 'אינדוקס',
  'שופיפיי', 'shopify', 'וורדפרס', 'wordpress', 'ווקומרס', 'woocommerce', 'תוסף', 'חנות', 'חנויות', 'איקומרס', 'ecommerce', 'אונליין',
  'מכיר', 'מוצר', 'קטגורי', 'סכמ', 'schema', 'מטא', 'כותרת', 'קישור', 'מהירות', 'המרה', 'תנועה',
  'מילות מפתח', 'תוכן', 'בלוג', 'chatgpt', 'gemini', 'perplexity', 'בינה מלאכותית', 'ai']

// כוונת-שירות ושמות-מותג. הביטויים הכי מבוקשים במרחב שלנו הם "חברת קידום
// אתרים" ו"מומחה קידום אתרים" — מי שמקליד אותם מחפש את מי לשכור, לא מאמר.
// נפח גבוה בלי הסינון הזה מושך את המכונה בדיוק לקהל הלא נכון.
const SEED_REJECT = [/חבר[הת]\s/, /מומחה/, /סוכנות/, /משרד/, /מחיר/, /עלות/, /כמה עולה/,
  /קורס/, /לימוד/, /דרוש/, /משרה/, /פרילנס/, /מנהל/, /freelanc/i, /agency/i, /jobs?\b/i,
  // ורטיקלים אחרים · "קידום אתרים לעורכי דין" הוא ביקוש אמיתי לקהל שאינו שלנו
  /עורכי דין|רופא|מרפא|נדל"ן|נדלן|מסעד|קליניק|רואה חשבון|ביטוח/]

const CLUSTER_SEEDS = {
  'geo-ai': ['קידום בבינה מלאכותית', 'chatgpt לעסקים', 'מנועי תשובה'],
  'seo-shopify': ['שופיפיי', 'קידום אתרים', 'seo לחנות'],
  ecommerce: ['חנות אונליין', 'איקומרס', 'מכירות אונליין'],
  guides: ['מחקר מילות מפתח', 'כלי seo', 'קידום אתרים מדריך'],
  'seo-general': ['קידום אתרים', 'קידום אורגני', 'seo טכני', 'דירוג בגוגל', 'מהירות אתר'],
  wordpress: ['קידום וורדפרס', 'seo וורדפרס', 'ווקומרס קידום', 'תוסף seo'],
}

const CLUSTERS = [
  { slug: 'geo-ai', title: 'GEO ואופטימיזציה למנועי AI', focus: 'איך נכנסים לתשובות של ChatGPT, Gemini, Perplexity ו-Claude · תוכן ציטוטבילי, נתונים מובנים, מדידת נראות ב-AI' },
  { slug: 'seo-shopify', title: 'SEO לחנויות שופיפיי', focus: 'קידום אורגני בגוגל לחנות Shopify · דפי מוצר, קטגוריות, מהירות, סכמות, קישור פנימי, תיקוני 301' },
  { slug: 'ecommerce', title: 'שיווק לאיקומרס ישראלי', focus: 'שיווק אורגני לחנות איקומרס ישראלית · תנועה בלי לשלם על כל קליק, המרה, תוכן שמוכר, עברית שמדורגת' },
  { slug: 'guides', title: 'מדריכים וכלים', focus: 'מדריכים מעשיים צעד-אחר-צעד · מחקר מילות מפתח, כלים, תהליכי עבודה למותגי איקומרס' },
  // ── נוספו 16.8.26 · אחרי מדידת נפחים אמיתית ──────────────────────────
  // ארבעת האשכולות המקוריים כולם נעולים על Shopify, ושם נמדדו 7 ביטויים
  // שמישים בלבד. "קידום אתרים כללי" החזיר 152 · פי עשרים ממנו. זה מרחב
  // הביקוש האמיתי, והוא היה סגור בפנינו בגלל הגדרה ולא בגלל שוק.
  { slug: 'seo-general', title: 'קידום אתרים אורגני', focus: 'קידום אורגני בגוגל לכל אתר · SEO טכני, מהירות, מבנה, סכמות, קישורים, מחקר מילות מפתח, דירוג בעברית. לא נעול לפלטפורמה אחת' },
  // וורדפרס קטן במספרים (6 ביטויים) אבל מדויק בקהל: "קידום אתרי וורדפרס"
  // 260/חודש. מי שמקליד את זה הוא בדיוק הלקוח של התוסף שבדרך.
  { slug: 'wordpress', title: 'SEO לוורדפרס ו-WooCommerce', focus: 'קידום אורגני לאתר וורדפרס ולחנות WooCommerce · תוספים, מבנה קבועים, מהירות, סכמות מוצר, תוכן שמדורג בעברית' },
]
const CLUSTER_BY_SLUG = Object.fromEntries(CLUSTERS.map((c) => [c.slug, c]))
const CLUSTER_BY_TITLE = Object.fromEntries(CLUSTERS.map((c) => [c.title, c]))
const VALID_INTENTS = new Set(['informational', 'commercial', 'transactional', 'navigational'])

// מילות-אות פר-אשכול לבדיקת-שפיות של שיוך: keyword+title שלא נוגעים באף אחת = כנראה נחת באשכול
// הלא-נכון (מחליש hubs ועוקף את הדה-דופ התוך-אשכולי). אזהרה בלבד — הרשימות חלקיות בכוונה.
// guides הוא סל-כל של מדריכים וכלים — בלי רשימה = בלי בדיקה.
const CLUSTER_SIGNALS = {
  'geo-ai': ['geo', 'aeo', 'ai', 'גיאו', 'בינה מלאכותית', "צ'אט", 'chatgpt', 'gpt', 'gemini', "ג'מיני", 'perplexity', 'פרפלקסיטי', 'claude', 'קלוד', 'llm', 'סוכנ', 'ציטוט', 'overviews', 'מנועי תשובה', 'נראות'],
  'seo-shopify': ['seo', 'קידום', 'גוגל', 'סכמ', 'schema', 'canonical', 'קנוניקל', '301', '404', 'sitemap', 'robots', 'אינדוקס', 'דירוג', 'מהירות', 'זחיל', 'מטא', 'קישור', 'core web'],
  ecommerce: ['שיווק', 'המרה', 'המרות', 'לקוח', 'עגלה', 'מייל', 'איקומרס', 'מכירה', 'מכירות', 'מותג', 'קהיל', 'ltv', 'ugc', 'שימור', 'תנועה', 'טראפיק', 'קמפיין'],
  guides: [],
  'seo-general': ['קידום', 'אורגני', 'seo', 'גוגל', 'דירוג', 'אינדוקס', 'סכמ', 'schema', 'מטא',
    'קישור', 'מהירות', 'core web', 'זחיל', 'sitemap', 'robots', 'canonical', '301', '404', 'מילות מפתח'],
  wordpress: ['וורדפרס', 'wordpress', 'ווקומרס', 'woocommerce', 'תוסף', 'תוספים', 'plugin',
    'yoast', 'rank math', 'elementor', 'קבועים', 'permalink'],
}

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

// Jaccard על סטים-של-מילים (keyword+title יחד) — תופס כמעט-כפילויות שההשוואה המדויקת של normKey
// מפספסת (סדר-מילים שונה, מילה נוספת/חסרה, ניסוח-משנה). סף 0.5 = חצי מהמילים משותפות → קניבליזציה.
// קידומות-שימוש עבריות (ו/ה/ב/ל/מ/ש/כ) מודבקות למילה ("המדריך"/"לחיבור") מפוצצות את ההשוואה —
// מסירים אחת כשנשארת מילה של 3+ תווים. סימטרי לשני הצדדים, לא ניתוח לשוני.
const JACCARD_THRESHOLD = 0.5
const OVERLAP_THRESHOLD = 0.66
const stripHebPrefix = (w) => /^[והבלמשכ]/.test(w) && w.length >= 4 ? w.slice(1) : w
const wordSet = (s) => new Set(normKey(s).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1).map(stripHebPrefix))
// כמעט-כפיל = Jaccard>=0.5 (חצי מהמילים משותפות) או Overlap>=0.66 (שני-שליש מהסט הקצר בתוך הארוך).
// ה-Overlap משלים את ה-Jaccard במקרה שנתפס בפועל: כותרת-חיה קצרה שנבלעת בתוך מועמד ארוך —
// האיחוד הגדול מדלל את היחס הסימטרי ומפספס קניבליזציה ברורה.
function nearDupe(a, b) {
  if (!a.size || !b.size) return false
  let inter = 0
  for (const w of a) if (b.has(w)) inter++
  return inter / (a.size + b.size - inter) >= JACCARD_THRESHOLD || inter / Math.min(a.size, b.size) >= OVERLAP_THRESHOLD
}

// ── פרסור הפלט של Gemini לרעיונות ──
// מבקשים שורות בפורמט: KEYWORD | TITLE | INTENT | HEAD   (אחד לשורה, בלי JSON — יציב מול grounding)
//
// HEAD נוסף אחרי שהתברר שהוראה בפרומפט לא מספיקה: סיפקנו 25 ביטויים אמיתיים
// עם נפח מדוד, והמודל בכל זאת המציא לונג-טייל משלו — ארבעה מתוך ארבעה
// נפסלו על אפס חיפושים. עכשיו הוא חייב להצהיר על איזה ביטוי *מהרשימה שלנו*
// הרעיון נשען, ואנחנו מאמתים חברות ברשימה במקום להאמין לו.
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
    let [keyword, title, intent, head] = parts
    if (!keyword || !title) continue
    if (keyword.length > 90 || title.length > 160) continue // מסנן שורות-זבל/משפטים ארוכים
    // שומר-זבל דטרמיניסטי: הד-של-פורמט (המודל מהדהד את שורת-התבנית KEYWORD | TITLE מילולית),
    // שדה קצר מדי, או intent שגלש ל-title כשהמודל השמיט עמודה — שני הדפוסים כבר שרפו תור.
    const junk = (s) => /^KEYWORD|^TITLE|\|/.test(s) || s.trim().length < 4
    if (junk(keyword) || junk(title) || VALID_INTENTS.has(title.toLowerCase())) continue
    intent = (intent || '').toLowerCase()
    if (!VALID_INTENTS.has(intent)) intent = 'informational'
    out.push({ cluster: clusterSlug, keyword, title, intent , head: (head || '').trim() })
  }
  return out
}

/**
 * ביטויים אמיתיים שאנשים בישראל מקלידים, לאשכול נתון.
 *
 * זו ההיפוך של המנוע: עד היום המודל *המציא* מילת מפתח ואז בדקנו אותה. כאן
 * גוגל מספקת את מה שבאמת מחפשים, והמודל בוחר מתוך רשימה קיימת. בלי זה השער
 * היה מרוקן את התור — נמדד: 48 מתוך 48 הנושאים שהיו בתור החזירו אפס חיפושים.
 *
 * שלושה מסננים, וכל אחד מהם נלמד מהנתונים ולא הונח מראש:
 *   נפח מינימלי  · מתחת לזה מאמר לא מחזיר את עלות הכתיבה
 *   תקרת-ראש     · "chatgpt" ב-1.8 מיליון הוא לא נושא, הוא ים
 *   רלוונטיות    · CLUSTER_SIGNALS פוסל שם-מותג ושגיאת-כתיב שחוזרים מ-Ads
 */
async function realTermsFor(cat, seenKeys) {
  if (!REAL_TERMS_PER_CLUSTER) return []
  const seeds = CLUSTER_SEEDS[cat.slug] || []
  if (!seeds.length) return []
  try {
    const ideas = await keywordIdeas(seeds, { market: 'IL', limit: 200 })
    const out = []
    for (const i of ideas) {
      if (!i.keyword || i.volume < MIN_REAL_VOLUME) continue
      if (MAX_HEAD_VOLUME && i.volume > MAX_HEAD_VOLUME) continue
      if (seenKeys.has(normKey(i.keyword))) continue
      if (!SEED_RELEVANT.some((sg) => i.keyword.includes(sg))) continue
      if (SEED_REJECT.some((re) => re.test(i.keyword))) continue
      out.push(i)
      if (out.length >= REAL_TERMS_PER_CLUSTER) break
    }
    return out
  } catch (e) {
    // נפילה חיננית: בלי ביטויים אמיתיים המודל חוזר להתנהגות הישנה, והשער
    // שבהמשך עדיין חוסם. שכבה שנעדרת לא שוברת את הצנרת.
    console.error(`[demand] ${cat.slug}: ${String(e).slice(0, 120)}`)
    return []
  }
}

const scanPrompt = (cat, existingTitles, existingKeywords, today, realTerms = []) => {
  const titles = existingTitles.slice(0, 80)
  const kws = existingKeywords.slice(0, 200)
  // אוגוסט-נובמבר = חלון ההכנה לנובמבר הישראלי: FIFO אומר שנושא עונתי שנכנס מאוחר יתפרסם מאוחר מדי.
  const month = parseInt(today.slice(5, 7), 10)
  const seasonal = month >= 8 && month <= 11
    ? `\nעונתיות: אנחנו בחלון ההכנה לנובמבר (בלאק פריידי / סייבר מאנדיי / שופינג IL). כלול לפחות רעיון אחד של הכנת חנויות Shopify ישראליות לנובמבר מזווית האשכול הזה — הכנות, לוחות זמנים, מלאי, SEO עונתי, נראות ב-AI לקניות חג.\n`
    : ''
  return `אתה חוקר-תוכן בכיר למגזין של "Scayla" — אפליקציית SEO/GEO ל-Shopify שמקדמת חנויות אונליין בגוגל וגם במנועי-התשובות של ה-AI (ChatGPT, Gemini, Perplexity, Claude). הקהל: בעלי חנויות Shopify ואנשי שיווק בישראל. התאריך היום: ${today}.

המשימה: השתמש בחיפוש Google כדי לזהות **פערי-תוכן טריים** באשכול הבא, ולהציע ${IDEAS_PER_CLUSTER + 3} רעיונות למאמרים חדשים שאין לנו עדיין.
אשכול: ${cat.title}
מיקוד: ${cat.focus}

גבולות האשכולות (כל רעיון חייב להשתייך לאשכול הנוכחי בלבד — רעיון שמתאים יותר לאשכול אחר, אל תציע אותו כאן):
${CLUSTERS.map((c) => `- ${c.title}${c.slug === cat.slug ? ' ← האשכול הנוכחי' : ''}: ${c.focus}`).join('\n')}

${realTerms.length ? `**ביטויים אמיתיים עם ביקוש מדוד** (Google Ads Keyword Planner · ישראל, עברית, חיפושים ממוצעים לחודש).
אלה לא הצעות — אלה מה שאנשים באמת מקלידים. כל שורה שתחזיר **חייבת** לכלול עמודה רביעית — HEAD — שהיא ביטוי **מועתק מילה-במילה מהרשימה הזאת**. שורה בלי HEAD, או עם HEAD שאינו ברשימה, נמחקת אוטומטית ולא נכתבת. ה-KEYWORD שלך יכול להיות לונג-טייל, אבל הוא חייב להישען על ה-HEAD שבחרת:
${realTerms.map((t) => `  • ${t.keyword} — ${t.volume}/חודש`).join('\n')}

` : ''}חקור מה קורה *עכשיו*:
- מה בעלי חנויות Shopify ואנשי SEO/GEO בישראל מחפשים בגוגל בתקופה האחרונה (מונחי-לונג-טייל, שאלות "איך/כמה/מתי/למה").
- שאלות People-Also-Ask ונושאים שמתחרים/בלוגים מקצועיים העלו לאחרונה.
- טרנדים/עדכונים חדשים (עדכוני Google, פיצ'רים חדשים ב-Shopify, שינויים ב-AI Overviews / ChatGPT / Perplexity) שעדיין לא כיסינו.
${seasonal}
**חובה: הימנע מכל נושא שכבר קיים אצלנו.** אלה הכותרות שכבר במגזין:
${titles.length ? titles.map((t) => `  • ${t}`).join('\n') : '  (אין עדיין)'}

ואלה מילות-המפתח שכבר בתוכנית/נעשו (אל תחזור עליהן ואל תבחר וריאציה כמעט-זהה):
${kws.length ? kws.map((k) => `  • ${k}`).join('\n') : '  (אין עדיין)'}

החזר **בדיוק** ${IDEAS_PER_CLUSTER + 3} שורות, שורה לרעיון, בפורמט המדויק (מופרד ב-|), בלי טקסט מקדים או מסכם ובלי JSON:
KEYWORD | TITLE | INTENT | HEAD

- KEYWORD: ביטוי-חיפוש קצר בעברית (2-6 מילים) שבן-אדם באמת מקליד בגוגל. ייחודי, לא חופף לרשימות למעלה.
- TITLE: כותרת-מאמר ממגנטת ומדויקת בעברית (עד ~12 מילים). אם שנה הכרחית — רק ${today.slice(0, 4)}, ועדיף על-זמני.
- INTENT: אחד מ: informational | commercial | transactional | navigational.

תמהיל-intent מחייב: לפחות 2 רעיונות commercial ולפחות רעיון אחד transactional בכל batch — לא הכל informational. כלול במפורש רעיונות השוואה ("X מול Y"), חלופות ("חלופות ל-..."), מעבר/הגירה מפלטפורמה או מכלי אחר, ותמחור/עלויות — הכל לשוק ה-Shopify הישראלי.

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
  // קורפוס ל-Jaccard: keyword+title של כל התור + כותרות המאמרים החיים — דחיית כמעט-כפיל גם מולם,
  // לא רק התאמה מדויקת (וריאציה קלה על נושא קיים = קניבליזציה, לא מאמר חדש).
  const seenWordSets = [
    ...topics.map((t) => wordSet(((t && t.keyword) || '') + ' ' + ((t && t.title) || ''))),
    ...allTitles.map((t) => wordSet(t)),
  ].filter((s) => s.size)

  const perCluster = {}
  const added = []
  const errors = []
  const rejected = []   // נפסלו על ביקוש · מדווח, לא נבלע בשקט

  for (const cat of targets) {
    perCluster[cat.slug] = 0
    // רשימות למניעת-כפילות שנשלחות למודל: כותרות קיימות + מילות-מפתח קיימות (גלובלי, לא רק האשכול).
    const existingTitles = [...titlesByCluster[cat.slug], ...topics.filter((t) => t && t.cluster === cat.slug).map((t) => t.title).filter(Boolean)]
    const existingKeywords = topics.map((t) => t && t.keyword).filter(Boolean)
    try {
      const realTerms = await realTermsFor(cat, seenKeys)
      const realIndex = new Map(realTerms.map((t) => [normKey(t.keyword), t.volume]))
      if (realTerms.length) console.error(`[demand] ${cat.slug}: ${realTerms.length} ביטויים אמיתיים · ${realTerms[0].volume}–${realTerms[realTerms.length - 1].volume}/חודש`)
      else console.error(`[demand] ${cat.slug}: אין ביטויים אמיתיים — המודל חוזר להמצאה, והשער יסנן`)
      const { text } = await callGemini(scanPrompt(cat, existingTitles, existingKeywords, today, realTerms), { search: true, maxTokens: 4000, temperature: 0.85 })
      const ideas = parseIdeas(text, cat.slug)
      // אכיפה רכה של תמהיל-intent: batch שכולו informational = המודל התעלם מהמכסה — מתריעים, לא זורקים.
      if (ideas.length && ideas.every((i) => i.intent === 'informational')) console.warn(`[${cat.slug}] אזהרה: כל ה-batch יצא informational למרות מכסת commercial/transactional בפרומפט`)
      for (const idea of ideas) {
        if (perCluster[cat.slug] >= IDEAS_PER_CLUSTER) break
        const kNorm = normKey(idea.keyword)
        const tNorm = normKey(idea.title)
        if (!kNorm || seenKeys.has(kNorm) || seenTitles.has(tNorm)) continue
        const ws = wordSet(idea.keyword + ' ' + idea.title)
        if (seenWordSets.some((s) => nearDupe(ws, s))) continue // כמעט-כפיל של התור או של מאמר חי

        // ── שער הביקוש ──────────────────────────────────────────────────
        // נכשל *סגור*: מקור 'unknown' (לא הצלחנו לבדוק) נפסל, בדיוק כמו נפח
        // נמוך. פרסום על ניחוש שלא אומת הוא איך שאתר מגיע ל-164 מאמרים
        // ולחמישה קליקים. הנפח נשמר על הרעיון · הוא מדרג את התור בהמשך.
        // כשסיפקנו ביטויים אמיתיים, ההצדקה חייבת להגיע מהם. בודקים חברות
        // ברשימה *שלנו* — לא שואלים את ה-API שוב ולא מאמינים למודל על מילה.
        if (realIndex.size) {
          const head = normKey(idea.head)
          if (!head || !realIndex.has(head)) { rejected.push(`${idea.keyword} · HEAD לא מהרשימה (${idea.head || 'חסר'})`); continue }
          idea.volume = realIndex.get(head)
          idea.demandSource = 'ads'
          idea.head = idea.head.trim()
        } else {
          // אין ביטויים אמיתיים (API למטה) — נופלים לבדיקה פר-ביטוי, שנכשלת סגור.
          let dem = null
          try { dem = await hasDemand(idea.keyword) } catch (e) { dem = { ok: false, reason: String(e).slice(0, 80), demand: null } }
          if (!dem.ok) { rejected.push(`${idea.keyword} · ${dem.reason}`); continue }
          idea.volume = dem.demand && typeof dem.demand.volume === 'number' ? dem.demand.volume : null
          idea.demandSource = dem.demand ? dem.demand.source : 'unknown'
        }
        // בדיקת-שפיות שיוך-אשכול: אזהרה בלבד, כדי שנתפוס שיוך שגוי בלוגים בלי לזרוק רעיון טוב.
        const signals = CLUSTER_SIGNALS[cat.slug] || []
        const hay = normKey(idea.keyword + ' ' + idea.title)
        if (signals.length && !signals.some((w) => hay.includes(w))) console.warn(`[${cat.slug}] אזהרה: "${idea.keyword}" לא נוגע באף מילת-אות של האשכול — ייתכן שיוך שגוי`)
        seenKeys.add(kNorm)
        seenTitles.add(tNorm)
        seenWordSets.push(ws)
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

  // ── דירוג לפי ביקוש ──────────────────────────────────────────────────
  // עד כה התור היה FIFO: נכתב מה שנכנס ראשון. עכשיו לכל פריט יש נפח, אז
  // הפריט המבוקש ביותר נכתב ראשון וה"פחות מבוקש" הוא זה שנגזם. גם בלי לפסול
  // רעיון אחד, השינוי הזה לבדו מסיט את המאמץ למקום שיש בו ביקוש.
  // יציבות: פריטים ללא נפח שומרים על סדרם היחסי בסוף, ולא קופצים.
  const _ord = new Map(topics.map((t, i) => [t, i]))
  topics.sort((a, b) => {
    const av = typeof a?.volume === 'number' ? a.volume : -1
    const bv = typeof b?.volume === 'number' ? b.volume : -1
    return bv - av || _ord.get(a) - _ord.get(b)
  })

  // ── prune: מה שנשאר מעל ה-cap נגזם מהזנב — כלומר הנמוך-ביותר-בביקוש ──
  let pruned = 0
  // ה-cap חל על נושאים *ממתינים* בלבד.
  //
  // באג קיים שנחשף כאן: הוא נספר מול כל הקובץ, כולל נושאים שכבר נכתבו. עם 147
  // כתובים מתוך 151 ו-cap של 120, הגזימה ביקשה למחוק 31 ומצאה בדיוק 4 מועמדים —
  // הטריים. כלומר לכל נושא חדש הייתה ריצה אחת להיכתב, ואם לא נבחר הוא נמחק
  // בריצה הבאה. התור מעולם לא הצליח לצבור נושאים טובים.
  // נתפס כשאשכול שלם עם חציון 1,300 נעלם בריצה שלאחריו.
  const pendingCount = topics.filter((t) => t && t.keyword && !done.has(t.keyword)).length
  if (pendingCount > TOPICS_CAP) {
    const overflow = pendingCount - TOPICS_CAP
    const addedSet = new Set(added) // רעיונות שנוספו עכשיו — לא לגזום
    // מהזנב פנימה. לפני שהתור מוין לפי ביקוש, "מתחילת המערך" היה גם "הישן
    // ביותר"; אחרי המיון ההתחלה היא דווקא המבוקש ביותר, ולולאה קדימה מחקה
    // בדיוק את הנושאים החזקים. נתפס אחרי שאשכול שלם עם חציון 1,300 נמחק.
    const drop = new Set()
    let toDrop = overflow
    for (let i = topics.length - 1; i >= 0 && toDrop > 0; i--) {
      const t = topics[i]
      if (!t || done.has(t.keyword) || addedSet.has(t)) continue
      drop.add(t); toDrop--; pruned++
    }
    topics = topics.filter((t) => !drop.has(t))
  }

  // כתיבה רק אם השתנה משהו (אידמפוטנטי — ריצה חוזרת בלי רעיונות חדשים לא נוגעת בקובץ).
  const withVol = added.filter((a) => typeof a.volume === 'number' && a.volume > 0)
  const demandLine = added.length
    ? `ביקוש: ${withVol.length}/${added.length} עם נפח מדוד` +
      (withVol.length ? ` · חציון ${withVol.map((a) => a.volume).sort((x, y) => x - y)[Math.floor(withVol.length / 2)]}/חודש` : '') +
      (rejected.length ? ` · ${rejected.length} נפסלו בשער` : '')
    : (rejected.length ? `כל ${rejected.length} הרעיונות נפסלו בשער הביקוש` : '')
  if (demandLine) console.error('[demand] ' + demandLine)
  if (rejected.length) console.error('[demand] דוגמאות: ' + rejected.slice(0, 5).join(' | '))

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
