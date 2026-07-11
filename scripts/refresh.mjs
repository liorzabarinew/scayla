#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// refresh.mjs — נתיב רענון/re-grounding למכונת התוכן של Scayla.
// לא כותב מאמר חדש — לוקח מאמר קיים, מאמת מחדש את הסטטיסטיקות שלו מול Google
// (Gemini 2.5 Pro + googleSearch), מתקן נתון מיושן/שגוי בלבד (בלי לשכתב סעיפים),
// ומעדכן אך ורק את updatedDate להיום. pubDate לעולם לא משתנה.
//
// אותה פילוסופיית fact-check של המכונה, אבל על מאמרים שכבר עלו.
// שמרני בכוונה: משנים רק מספר/אחוז/שנה שניתן לאמת שהוא מיושן, אף פעם לא פסקה שלמה.
//
// env: GOOGLE_SA (fallback: .secrets/sa.json), GCP_PROJECT (=scayla-prod),
//      GCP_REGION(=us-central1), GEMINI_MODEL(=gemini-2.5-pro)
// הרצה:  node scripts/refresh.mjs [slug]     (בלי slug → המאמר עם ה-updatedDate הישן ביותר)
// ──────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createRequire } from 'module'
import { notify } from './notify.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ARTICLES_DIR = join(ROOT, 'src/content/magazine')
const SA_FILE = join(ROOT, '.secrets/sa.json')

// SA: מ-env, אחרת מקובץ הסוד המקומי (gitignored). fail-closed אם אין.
const SA = process.env.GOOGLE_SA || (existsSync(SA_FILE) ? readFileSync(SA_FILE, 'utf8') : null)
if (!SA) { console.error('GOOGLE_SA (or .secrets/sa.json) is required'); process.exit(1) }
let _sa
try { _sa = JSON.parse(SA) } catch (e) { console.error('SA is not valid JSON:', String(e).slice(0, 120)); process.exit(1) }
const PROJECT = process.env.GCP_PROJECT || _sa.project_id
if (!PROJECT) { console.error('GCP_PROJECT (or project_id in SA) is required'); process.exit(1) }
const REGION = process.env.GCP_REGION || 'us-central1'
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro'

function result(obj) { console.log('RESULT:' + JSON.stringify(obj)) }

// js-yaml לוולידציית-frontmatter אמיתית — לא כותבים בחזרה מאמר שה-YAML שלו נשבר.
let _yaml = null
try { _yaml = createRequire(import.meta.url)('js-yaml') } catch (e) { console.error('⚠ js-yaml failed to load — fmParses fails CLOSED:', String(e).slice(0, 120)) }
const fmParses = (md) => {
  if (!_yaml) return false // fail-CLOSED: עדיף להחזיק מלכתוב מאמר שה-YAML שלו לא מאומת
  const m = String(md).match(/^---\n([\s\S]*?)\n---/)
  if (!m) return false
  try { _yaml.load(m[1]); return true } catch { return false }
}

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

// endpoint פר-מודל/אזור. region==='global' → host גלובלי (שם זמין gemini-2.5-flash שאינו ב-us-central1).
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
async function postJSONRetry(url, headers, body, { timeoutMs = 120_000, retries = 2 } = {}) {
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

async function callGemini(prompt, { search = false, maxTokens = 8000, temperature = 0.3, thinkingBudget, model = MODEL, region = REGION } = {}) {
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature, ...(thinkingBudget != null ? { thinkingConfig: { thinkingBudget } } : {}) },
    ...(search ? { tools: [{ googleSearch: {} }] } : {}),
  }
  const j = await postJSONRetry(endpointFor(model, region), { authorization: `Bearer ${await getToken()}`, 'content-type': 'application/json' }, body)
  if (j.error) throw new Error(`gemini ${j.error.code || ''}: ${j.error.message || JSON.stringify(j).slice(0, 200)}`)
  const cand = j.candidates?.[0]
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim()
  const gm = cand?.groundingMetadata || {}
  const sources = (gm.groundingChunks || [])
    .map((c) => ({ title: (c.web?.title || '').replace(/"/g, "'"), url: c.web?.uri || '' })).filter((s) => s.url)
  return { text, sources }
}

// ── עוזרי frontmatter/גוף ──
function splitDoc(md) {
  const m = md.match(/^(---\n[\s\S]*?\n---)\n?([\s\S]*)$/)
  if (!m) return null
  return { fm: m[1], body: m[2] }
}
const fmField = (fm, name) => {
  const m = fm.match(new RegExp(`^${name}:\\s*(.+?)\\s*$`, 'm'))
  return m ? m[1].replace(/^["']|["']$/g, '') : ''
}

// ── מצאי + בחירת מאמר ──
function listArticles() {
  const arts = []
  if (!existsSync(ARTICLES_DIR)) return arts
  for (const f of readdirSync(ARTICLES_DIR)) {
    if (!f.endsWith('.md')) continue
    const path = join(ARTICLES_DIR, f)
    const txt = readFileSync(path, 'utf8')
    arts.push({
      slug: f.replace(/\.md$/, ''),
      path,
      title: fmField(txt, 'title'),
      pubDate: fmField(txt, 'pubDate'),
      updatedDate: fmField(txt, 'updatedDate') || fmField(txt, 'pubDate'),
      draft: /^draft:\s*true/m.test(txt),
    })
  }
  return arts
}
// בוחר את המאמר עם ה-updatedDate הישן ביותר (המועמד הבשל ביותר לרענון).
function pickOldest(arts) {
  const pub = arts.filter((a) => !a.draft)
  const pool = pub.length ? pub : arts
  return pool.slice().sort((a, b) => String(a.updatedDate).localeCompare(String(b.updatedDate)))[0] || null
}

// ── ליבה: אימות מחדש מבוסס-grounding ──
// מבקשים מ-Gemini לזהות כל מספר/אחוז/שנה בגוף, לאמת מול חיפוש-Google, ולהחזיר
// אך ורק תיקונים בטוחים כ-JSON: [{ find, replace, reason, source }].
// find חייב להיות מחרוזת מדויקת מהגוף כדי שהחלפה תהיה ניתוחית ולא תזיז מבנה.
function buildVerifyPrompt({ title, body, existingSources, today }) {
  const srcList = existingSources.length
    ? existingSources.map((s, i) => `${i + 1}. ${s.title} — ${s.url}`).join('\n')
    : '(אין מקורות מצוטטים ב-frontmatter)'
  return `אתה עורך-עובדות (fact-checker) שמרן למגזין SEO/GEO ישראלי. התאריך היום: ${today}.
לפניך מאמר קיים ("${title}"). המשימה: לאמת מחדש את הסטטיסטיקות שבו מול חיפוש-Google עדכני, ולהחזיר אך ורק תיקונים בטוחים.

חוקי-ברזל (שמרנות מוחלטת):
- שנה אך ורק מספרים, אחוזים, סכומים או שנים שניתן לאמת שהם מיושנים או שגויים לעומת מקור עדכני ומהימן.
- לעולם אל תשכתב פסקאות, משפטים או ניסוח. אל תשנה מבנה, כותרות, קישורים, ניקוד או סגנון.
- אם נתון עדיין נכון/עדכני — אל תיגע בו. אם אינך בטוח ב-100% שהוא מיושן — אל תיגע בו.
- מחרוזת ה-find חייבת להיות העתק מדויק ורציף מתוך גוף המאמר (כולל הסימן %/₪ ומילים סמוכות אם צריך כדי שתהיה חד-משמעית), כדי שהחלפת-מחרוזת פשוטה תעבוד בלי להזיז שום דבר אחר.
- replace = אותו קטע בדיוק, עם המספר המעודכן בלבד. שמור אורך/פורמט דומה.
- כל תיקון חייב source: כתובת URL אמיתית ומהימנה שתומכת ישירות במספר החדש.
- מקסימום 6 תיקונים. אם אין מה לתקן — החזר [].

מקורות שכבר מצוטטים במאמר (העדף לאמת מולם, אבל חפש גם עדכני יותר):
${srcList}

גוף המאמר (Markdown):
"""
${body}
"""

החזר אך ורק JSON תקין במבנה הבא, בלי טקסט נוסף ובלי code fences:
{"changes":[{"find":"...","replace":"...","reason":"למה זה היה מיושן","source":"https://..."}]}`
}

// חילוץ JSON עמיד (מסיר code fences / טקסט עוטף).
function parseChanges(text) {
  let t = String(text || '').trim()
  t = t.replace(/^```(?:json)?\s*/i, '').replace(/\s*```$/, '')
  const s = t.indexOf('{'), e = t.lastIndexOf('}')
  if (s === -1 || e === -1 || e <= s) return []
  try {
    const obj = JSON.parse(t.slice(s, e + 1))
    const arr = Array.isArray(obj) ? obj : (obj.changes || [])
    return arr
      .filter((c) => c && typeof c.find === 'string' && typeof c.replace === 'string' && c.find.length >= 1 && c.find !== c.replace)
      .slice(0, 6)
  } catch { return [] }
}

async function run() {
  const today = new Date().toISOString().slice(0, 10)
  const arg = process.argv[2] && !process.argv[2].startsWith('-') ? process.argv[2] : null
  const arts = listArticles()
  if (!arts.length) { result({ status: 'error', reason: 'no articles found in ' + ARTICLES_DIR }); process.exit(1) }

  let art
  if (arg) {
    const wanted = arg.replace(/\.md$/, '')
    art = arts.find((a) => a.slug === wanted)
    if (!art) { result({ status: 'error', reason: `slug not found: ${wanted}` }); process.exit(1) }
  } else {
    art = pickOldest(arts)
  }
  if (!art) { result({ status: 'error', reason: 'could not pick an article' }); process.exit(1) }

  const md = readFileSync(art.path, 'utf8')
  const doc = splitDoc(md)
  if (!doc) { result({ status: 'error', slug: art.slug, reason: 'could not split frontmatter' }); process.exit(1) }

  // מקורות קיימים מה-frontmatter (רשימת title/url) — כהקשר לאימות.
  const existingSources = []
  {
    const sm = doc.fm.match(/^sources:\n([\s\S]*?)(?=^\S|\Z)/m)
    if (sm) {
      const re = /- title:\s*["']?(.+?)["']?\s*\n\s*url:\s*["']?(.+?)["']?\s*$/gm
      let m
      while ((m = re.exec(sm[1]))) existingSources.push({ title: m[1], url: m[2] })
    }
  }

  let verifyRes
  try {
    verifyRes = await callGemini(buildVerifyPrompt({ title: art.title, body: doc.body, existingSources, today }),
      { search: true, maxTokens: 6000, temperature: 0.2, thinkingBudget: 2048 })
  } catch (e) {
    result({ status: 'error', slug: art.slug, reason: 'verify call failed: ' + String(e).slice(0, 160) })
    await notify(`⚠️ refresh נכשל · ${art.slug}: ${String(e).slice(0, 120)}`)
    process.exit(1)
  }

  const proposed = parseChanges(verifyRes.text)

  // החלת תיקונים שמרנית: רק find שקיים מילולית בגוף (מדויק, מופע ראשון). לוגים לכל דחייה.
  let body = doc.body
  const applied = []
  for (const c of proposed) {
    if (!c.source || !/^https?:\/\//.test(String(c.source))) { console.error('דחוי (אין source תקין):', JSON.stringify(c).slice(0, 120)); continue }
    const idx = body.indexOf(c.find)
    if (idx === -1) { console.error('דחוי (find לא נמצא מילולית בגוף):', JSON.stringify(c.find).slice(0, 120)); continue }
    // מחליף רק את המופע הראשון, בלי regex (הימנעות מהחלפות לא-מכוונות).
    body = body.slice(0, idx) + c.replace + body.slice(idx + c.find.length)
    applied.push({ find: c.find, replace: c.replace, reason: c.reason || '', source: c.source })
  }

  const reVerified = true // אימות אמיתי רץ (קריאת-grounding הושלמה) → מותר לגעת ב-updatedDate בלבד.
  const changed = applied.length > 0

  // בונים מסמך חדש: גוף מעודכן (אם היו תיקונים) + updatedDate=today. pubDate לעולם לא נוגע.
  let newFm = doc.fm
  if (/^updatedDate:/m.test(newFm)) {
    newFm = newFm.replace(/^updatedDate:.*$/m, `updatedDate: ${today}`)
  } else {
    // אם משום מה חסר — מוסיפים אחרי pubDate (בלי לגעת ב-pubDate עצמו).
    newFm = /^pubDate:/m.test(newFm)
      ? newFm.replace(/^(pubDate:.*)$/m, `$1\nupdatedDate: ${today}`)
      : newFm.replace(/\n---$/, `\nupdatedDate: ${today}\n---`)
  }
  // שמירת-בטיחות: pubDate המקורי לא השתנה.
  if (fmField(newFm, 'pubDate') !== fmField(doc.fm, 'pubDate')) {
    result({ status: 'error', slug: art.slug, reason: 'pubDate mutated — aborting (must never change)' })
    process.exit(1)
  }

  let out = `${newFm}\n${body}`
  if (!out.endsWith('\n')) out += '\n'

  // שער-build: לא כותבים בחזרה מסמך שה-YAML שלו נשבר.
  if (!fmParses(out)) {
    result({ status: 'error', slug: art.slug, reason: 'frontmatter YAML invalid after refresh — not writing (build-safety guard)' })
    await notify(`⚠️ refresh · ${art.slug}: YAML נשבר אחרי רענון, לא נכתב`)
    process.exit(1)
  }

  writeFileSync(art.path, out)

  const status = changed ? 'refreshed' : 'verified'
  const r = {
    status, slug: art.slug, title: art.title,
    pubDate: fmField(doc.fm, 'pubDate'), updatedDate: today,
    reVerified, changes: applied.length, applied,
    proposedButRejected: proposed.length - applied.length,
    url: `/magazine/${art.slug}`,
  }
  result(r)

  const line = changed
    ? `♻️ רועננו ${applied.length} נתונים · <b>${art.title || art.slug}</b> (updatedDate→${today})`
    : `✅ אומת ואין מה לעדכן · <b>${art.title || art.slug}</b> (updatedDate→${today})`
  await notify(line)
}

run().catch(async (e) => {
  console.error(e)
  result({ status: 'error', reason: String(e).slice(0, 200) })
  try { await notify(`⚠️ refresh crash: ${String(e).slice(0, 140)}`) } catch { /* no-op */ }
  process.exit(1)
})
