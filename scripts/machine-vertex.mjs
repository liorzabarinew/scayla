#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// machine-vertex.mjs — מכונת התוכן של Scayla (Gemini 2.5 Pro על Vertex AI).
// פורט נאמן ממכונת ה-SEO/GEO של בנק-קט, מותאם להקשר ולסכמה של Scayla.
//
// צינור (קריאה אחת = מאמר אחד):
//   1. מחקר-מבוסס-grounding → תדריך → כתיבה → בקרת-QA רב-מודלית → הרכבה.
//   2. מבנה GEO עשיר: תשובה-ישירה מודגשת, סטטיסטיקות מצוטטות, "מה חשוב לזכור", FAQ, updatedDate.
//   3. מקורות אמיתיים: grounding של Google, ה-redirects נפתחים לכתובות עומק.
//   4. קישור פנימי חכם: מקשר למאמרים/אשכולות קיימים רלוונטיים.
//   5. מצב "בנק": ברירת מחדל draft:true (נכתב למאגר), --publish לפרסום מיידי.
//
// env: GOOGLE_SA, GCP_PROJECT, GCP_REGION(=us-central1), GEMINI_MODEL(=gemini-2.5-pro)
// הרצה: GOOGLE_SA="$(cat sa.json)" GCP_PROJECT=scayla node scripts/machine-vertex.mjs [cluster|--publish]
// ──────────────────────────────────────────────────────────────────────────

import crypto from 'crypto'
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { normalizeBrands, glossaryForPrompt } from './brand-glossary.mjs'
import { factsForPrompt, lintFacts } from './fact-glossary.mjs'
import { sourceBankForPrompt } from './source-bank.mjs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createRequire } from 'module'

// js-yaml (מ-node_modules של הפרויקט) לוולידציית-frontmatter אמיתית — שומר קשיח נגד תקלת-build שקטה.
let _yaml = null
try { _yaml = createRequire(import.meta.url)(join(dirname(fileURLToPath(import.meta.url)), '..', 'node_modules', 'js-yaml')) } catch { /* no-op */ }
const fmParses = (md) => {
  if (!_yaml) return true
  const m = String(md).match(/^---\n([\s\S]*?)\n---/)
  if (!m) return false
  try { _yaml.load(m[1]); return true } catch { return false }
}

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ARTICLES_DIR = join(ROOT, 'src/content/magazine')
const TOPICS_FILE = join(ROOT, 'scripts/topics.json')
const DONE_FILE = join(ROOT, 'scripts/topics-done.json')
const SA = process.env.GOOGLE_SA
const PROJECT = process.env.GCP_PROJECT
const REGION = process.env.GCP_REGION || 'us-central1'
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro'
// שכבת-QA שנייה עצמאית (חוצת-משפחה): Claude על Vertex Model Garden, דרך אותו service-account.
// ריק = כבוי → הצינור מתנהג כמו Gemini-QA בלבד. הפעלה: QA_CLAUDE_MODEL=claude-sonnet-4-5@YYYYMMDD
const QA_CLAUDE_MODEL = process.env.QA_CLAUDE_MODEL || ''
const QA_CLAUDE_REGION = process.env.QA_CLAUDE_REGION || 'us-east5'
const PUBLISH_NOW = process.argv.includes('--publish') // אחרת: נכתב למאגר (draft:true)
if (!SA || !PROJECT) { console.error('GOOGLE_SA and GCP_PROJECT are required'); process.exit(1) }

// משוכפל מ-src/content.config.ts כדי שהסקריפט עצמאי. slug = ה-URL הנקי של האשכול.
const CLUSTERS = [
  { slug: 'geo-ai', title: 'GEO ואופטימיזציה למנועי AI', focus: 'איך נכנסים לתשובות של ChatGPT, Gemini, Perplexity ו-Claude · תוכן ציטוטבילי, נתונים מובנים, מדידת נראות ב-AI' },
  { slug: 'seo-shopify', title: 'SEO לחנויות שופיפיי', focus: 'קידום אורגני בגוגל לחנות Shopify · דפי מוצר, קטגוריות, מהירות, סכמות, קישור פנימי, תיקוני 301' },
  { slug: 'ecommerce', title: 'שיווק לאיקומרס ישראלי', focus: 'שיווק אורגני לחנות איקומרס ישראלית · תנועה בלי לשלם על כל קליק, המרה, תוכן שמוכר, עברית שמדורגת' },
  { slug: 'guides', title: 'מדריכים וכלים', focus: 'מדריכים מעשיים צעד-אחר-צעד · מחקר מילות מפתח, כלים, תהליכי עבודה למותגי איקומרס' },
]
const CLUSTER_BY_SLUG = Object.fromEntries(CLUSTERS.map((c) => [c.slug, c]))
const CLUSTER_BY_TITLE = Object.fromEntries(CLUSTERS.map((c) => [c.title, c]))
const CLUSTER_SLUGS = new Set(CLUSTERS.map((c) => c.slug))
const CAT_PATHS = CLUSTERS.map((c) => `/magazine/cluster/${c.slug}`).join(' , ')
const CLUSTER_NAMES = CLUSTERS.map((c) => c.title).join(' | ')

// כותבים אמיתיים (E-E-A-T) · byline מקושר ל-/experts. איזון 2/2 לריצה יומית של 4:
// נוי קייטל (מומחית SEO/GEO) → geo-ai + seo-shopify · ליאור צברי (שיווק) → ecommerce + guides.
const AUTHOR_BY_CLUSTER = {
  'geo-ai': 'נוי קייטל',
  'seo-shopify': 'נוי קייטל',
  'ecommerce': 'ליאור צברי',
  'guides': 'ליאור צברי',
}

function result(obj) { console.log('RESULT:' + JSON.stringify(obj)) }

// ── Google auth (SA JWT → access token), ללא תלות חיצונית ──
const b64url = (b) => Buffer.from(b).toString('base64url')
let _token = null
async function getToken() {
  if (_token) return _token
  const sa = JSON.parse(SA)
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

const ENDPOINT = () => `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/publishers/google/models/${MODEL}:generateContent`

let CALLS = 0
async function callGemini(prompt, { search = false, maxTokens = 8000, temperature = 0.7, thinkingBudget } = {}) {
  CALLS++
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt }] }],
    generationConfig: { maxOutputTokens: maxTokens, temperature, ...(thinkingBudget != null ? { thinkingConfig: { thinkingBudget } } : {}) },
    ...(search ? { tools: [{ googleSearch: {} }] } : {}),
  }
  const res = await fetch(ENDPOINT(), {
    method: 'POST', headers: { authorization: `Bearer ${await getToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify(body),
  })
  const j = await res.json()
  if (j.error) throw new Error(`gemini ${j.error.code || ''}: ${j.error.message || JSON.stringify(j).slice(0, 200)}`)
  const cand = j.candidates?.[0]
  const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim()
  const gm = cand?.groundingMetadata || {}
  const sources = (gm.groundingChunks || [])
    .map((c) => ({ title: (c.web?.title || '').replace(/"/g, "'"), url: c.web?.uri || '' })).filter((s) => s.url)
  const grounded = (gm.groundingSupports || [])
    .map((s) => (s.segment?.text || '').trim()).filter((t) => t.length > 0)
  return { text, sources, grounded }
}

// ── מבקר עצמאי חוצה-משפחה: Claude על Vertex (publishers/anthropic), אותו service-account ──
async function callClaude(prompt, { maxTokens = 4000 } = {}) {
  CALLS++
  const url = `https://${QA_CLAUDE_REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${QA_CLAUDE_REGION}/publishers/anthropic/models/${QA_CLAUDE_MODEL}:rawPredict`
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${await getToken()}`, 'content-type': 'application/json' },
    body: JSON.stringify({ anthropic_version: 'vertex-2023-10-16', max_tokens: maxTokens, messages: [{ role: 'user', content: prompt }] }),
  })
  const j = await res.json()
  if (j.error || j.type === 'error') throw new Error('claude: ' + JSON.stringify(j.error || j).slice(0, 200))
  return (j.content || []).map((p) => p.text || '').join('').trim()
}

// ── מצאי קיים (לבחירת נושא + קישור פנימי) ──
function scanArticles() {
  const arts = []
  if (existsSync(ARTICLES_DIR)) {
    for (const f of readdirSync(ARTICLES_DIR)) {
      if (!f.endsWith('.md')) continue
      const txt = readFileSync(join(ARTICLES_DIR, f), 'utf8')
      const clusterTitle = (txt.match(/^cluster:\s*["']?(.+?)["']?\s*$/m) || [])[1] || ''
      const c = CLUSTER_BY_TITLE[clusterTitle]
      arts.push({
        slug: f.replace(/\.md$/, ''),
        title: (txt.match(/^title:\s*"([^"]*)"/m) || [])[1] || '',
        cluster: c ? c.slug : '',
      })
    }
  }
  const counts = {}
  for (const a of arts) if (a.cluster) counts[a.cluster] = (counts[a.cluster] || 0) + 1
  return { arts, counts }
}

function loadDone() {
  try { return existsSync(DONE_FILE) ? new Set(JSON.parse(readFileSync(DONE_FILE, 'utf8'))) : new Set() } catch { return new Set() }
}
function markDone(keyword) {
  if (!keyword) return
  const done = loadDone()
  if (done.has(keyword)) return
  done.add(keyword)
  writeFileSync(DONE_FILE, JSON.stringify([...done]))
}

// בוחר נושא: הנושא הבא בתוכנית שעדיין לא טופל (topics.json); אחרת האשכול הכי פחות מכוסה.
function pickTopic(counts) {
  if (existsSync(TOPICS_FILE)) {
    try {
      const topics = JSON.parse(readFileSync(TOPICS_FILE, 'utf8'))
      const done = loadDone()
      const next = topics.find((t) => t && t.cluster && CLUSTER_BY_SLUG[t.cluster] && t.keyword && !done.has(t.keyword))
      if (next) return { cat: CLUSTER_BY_SLUG[next.cluster], brief: next.title || next.angle || '', keyword: next.keyword || '', seeds: Array.isArray(next.seeds) ? next.seeds : [], fromPlan: true }
    } catch (e) { console.error('topics.json parse error:', String(e)) }
  }
  let best = CLUSTERS[0], bestN = Infinity
  for (const c of CLUSTERS) { const n = counts[c.slug] || 0; if (n < bestN) { best = c; bestN = n } }
  return { cat: best, brief: '', keyword: '', seeds: [], fromPlan: false }
}

// מועמדי-קישור-פנימי לכותב: same-cluster תחילה, ואז מעט מאשכולות אחרים.
function relatedList(cat, arts, max = 6) {
  const titled = arts.filter((a) => a.title)
  const same = titled.filter((a) => a.cluster === cat.slug)
  const other = titled.filter((a) => a.cluster !== cat.slug)
  const ordered = [...same, ...other].slice(0, max)
  return ordered.map((a) => `- "${a.title}" → /magazine/${a.slug}`).join('\n')
}

// ── שלב 1: מחקר → תדריך (grounded) ──
const briefPrompt = (cat, topicHint, seedUrls = [], existingTitles = []) => {
  const seeds = (seedUrls || []).map((u) => String(u).trim()).filter(Boolean)
  const seedBlock = seeds.length
    ? `\nמקורות-זרע ספציפיים לנושא הזה (חפש אותם דרך Google, קרא לעומק, ושאב מהם זווית, מבנה ועובדות):\n${seeds.map((u) => `  - ${u}`).join('\n')}\nאיסור-העתקה: אסור להעתיק או לשכתב-קלות אף משפט מהם. נסח הכל מחדש בקול של Scayla. אמת כל עובדה מהם בחיפוש עצמאי לפני שתכלול אותה.\n`
    : ''
  const covered = (existingTitles || []).filter(Boolean).slice(0, 60)
  const coveredBlock = covered.length
    ? `\nכותרות שכבר קיימות במגזין (אסור לחזור עליהן או לבחור זווית חופפת/כמעט-זהה — הזווית שלך חייבת לענות על שאלה שאף אחת מהן לא עונה עליה):\n${covered.map((t) => `  • ${t}`).join('\n')}\n`
    : ''
  return `אתה חוקר-תוכן בכיר למגזין של "Scayla" — אפליקציית SEO/GEO ל-Shopify שמקדמת חנויות אונליין בגוגל וגם במנועי-התשובות של ה-AI (ChatGPT, Gemini, Perplexity, Claude). הקהל: בעלי חנויות Shopify ואנשי שיווק בישראל.

חקור לעומק בעזרת חיפוש Google והכן תדריך למאמר מנצח${topicHint ? ` בנושא: "${topicHint}"` : ` באשכול: ${cat.title} (${cat.focus}). בחר זווית ספציפית ובעלת ערך חיפוש גבוה.`}
${seedBlock}${coveredBlock}${sourceBankForPrompt()}

מטרה כפולה: דירוג ב-Google + ציטוט ע"י מנועי AI (ChatGPT/Perplexity/Gemini). לכן דרושים נתונים אמיתיים, ספציפיים ועדכניים.

החזר תדריך בעברית, בטקסט מובנה (לא JSON), בדיוק בשדות הבאים:
ANGLE: <זווית/כותרת ממוקדת ומבדלת, מה השאלה המדויקת>
DIRECT_ANSWER: <תשובה ישירה 40-60 מילים שעומדת בפני עצמה גם מחוץ למאמר. המשפט הראשון חייב לפתוח בשם-הנושא המלא (לא בכינוי/מילת-קישור) ולענות ישירות על שאלת-הכותרת>
STATS: <3-4 עובדות אמיתיות. פורמט לכל שורה בדיוק, מופרד ב-| : <מספר/אחוז> | <ניסוח העובדה> | <שם המקור המדויק> | <URL מלא של העמוד הספציפי שבו הנתון מופיע>. אסור לרשום סטטיסטיקה ללא URL ספציפי שמצאת בחיפוש. אם אין URL ספציפי לנתון, אל תכלול אותו>
QUOTE: <ציטוט אחד מילה-במילה (verbatim) שמצאת בחיפוש, בפורמט: <טקסט הציטוט> | <שם הדובר/הגוף> | <URL>. אם לא מצאת ציטוט אמיתי עם URL, כתוב בדיוק "אין". אסור לנסח/לפרפרז ציטוט ולייחס אותו>
TABLE: <רעיון לטבלת השוואה אם מתאים (2 עמודות לדוגמה), או "אין">
SECTIONS: <6-8 כותרות H2 שמכסות את הנושא לעומק, לפחות 2-3 בצורת שאלה שבעל-חנות מקליד בגוגל ("איך...?", "כמה...?", "מתי...?"). לכל סעיף ציין זווית/תת-שאלה קונקרטית. המטרה: מאמר מקיף 900-1,200 מילים, לא רשימת-נושאים שטחית>
FAQ: <4 שאלות נפוצות אמיתיות, כל אחת עם תשובה קצרה>

חוקי-ברזל: אך ורק עובדות אמיתיות שמצאת בחיפוש, בלי המצאות. לכל מספר ב-STATS חייב להתאים URL נפרד; סטטיסטיקה בלי URL = השמט. ציטוט מומצא או מפורפרז המיוחס לאדם/גוף בשם = פסילה; בספק כתוב "אין". אסור להבטיח תוצאות.`
}

// ── שלב 2: כתיבה (מהתדריך + קישורים פנימיים) ──
const writePrompt = (cat, brief, related, today) => `אתה כותב מאמר למגזין של "Scayla" (SEO/GEO ל-Shopify, קהל: בעלי חנויות ואנשי שיווק בישראל). קול של איש-מקצוע שיווקי שמדבר עם בעל-עסק, חם ופרקטי ובוטח, בלי יומרה אקדמית ובלי באזזוורדס ריקים.

השנה הנוכחית היא ${today.slice(0, 4)}. **אל תכתוב שנה שחלפה בכותרת או ב-slug**. העדף ניסוח על-זמני (evergreen); ואם שנה הכרחית, השתמש אך ורק ב-${today.slice(0, 4)}.

כתוב מאמר מנצח ל-SEO ול-GEO על בסיס התדריך הזה:
${brief}

מאמרים קיימים שאפשר לקשר אליהם (שלב 2-3 קישורים פנימיים רלוונטיים בטקסט-עוגן טבעי בתוך משפט, לא כרשימה):
${related || '(אין עדיין)'}
נתיבי-אשכול חוקיים לקישור-פנימי (אם אין מאמר ספציפי מתאים): ${CAT_PATHS}

מבנה המאמר (קריטי לציטוט ב-AI, מבוסס מחקר GEO):
**אורך: 900-1,200 מילים. תעמיק: דוגמאות קונקרטיות, תרחישים אמיתיים, תת-שאלות, ופרקטיקה ליישום בחנות. אל "תמרח": כל פסקה חייבת להוסיף ערך. עדיף 1,000 מילים של ערך מאשר 600 שטחיות.**
**קריאוּת: פסקאות קצרות (2-3 שורות), הדגש משפטי-מפתח בטקסט מודגש, ובולטים/טבלאות כדי שבעל-חנות יסרוק במהירות.**
- פסקה ראשונה: **תשובה ישירה מודגשת (**טקסט**) של 40-60 מילים** שעונה מיד על שאלת המאמר ועומדת בפני עצמה (זה ה-direct answer ל-GEO). המשפט הראשון פותח בשם-הנושא המלא.
- 6-8 כותרות H2 (##) שמכסות לעומק. לפחות 2-3 בצורת שאלה ("איך...?", "כמה...?", "מתי...?"). הפסקה הראשונה אחרי כותרת-שאלה עונה ישירות ב-1-2 משפטים, ורק אז מרחיבה.
- שלב אך ורק סטטיסטיקות שמופיעות ב-STATS בתדריך (אומתו עם URL), כל אחת עם שם-המקור באותו משפט. אסור להוסיף מספר/אחוז שלא ב-STATS. אם התדריך דל, כתוב איכותית ("לרוב", "מחקרים מצביעים") במקום להמציא מספר.
- ציטוט: שלב רק אם ב-QUOTE בתדריך יש טקסט verbatim עם שם+URL, והעתק מילה-במילה. אחרת אל תמציא.
- אם יש רעיון-טבלה בתדריך, הוסף טבלת-השוואה ב-Markdown (מספר עמודות עקבי).
- בלוק "## מה חשוב לזכור" עם 3-4 נקודות תמצית (bullets).
- הגדר מושג-מפתח אחד בבירור (לבהירות ל-AI).
- 3-5 קישורים פנימיים מהרשימה/מהאשכולות, בטקסט-עוגן תיאורי (3-6 מילים, לעולם לא "כאן"/"לחצו"), בתוך משפט רץ.
- אל תכתוב סעיף "## שאלות נפוצות" בגוף. ה-FAQ נכנס אך ורק לשדה faq ב-frontmatter.

${factsForPrompt()}

חוקי-ברזל: עברית בלבד. אסור להבטיח תוצאות ("דירוג ראשון מובטח", "מובטח", "תוך X ימים") — דבר בעקרונות והסתברויות. אל תמכור את Scayla בכל פסקה, הזכר לכל היותר פעם אחת בסוף ורק אם טבעי. אסור קו מפריד ארוך (— או –), במקומו נקודה-מפרידה " · " או פסיק. פורמט מרקדאון נקי (פסקה=בלוק רציף, פריט רשימה בשורה אחת).
**מקוריות מוחלטת: נסח הכל מחדש בלשונך. אסור להעתיק או לשכתב-קלות אף משפט ממקור. מותר לשאוב רעיון/זווית/עובדה, אבל הניסוח כולו מאפס, בקול של Scayla.**
**אנטי-חרטוט (קריטי): כל מספר, אחוז, סטטיסטיקה או מחקר חייב להיות אמיתי ומאומת בחיפוש. אסור להמציא נתונים ואסור לייחס נתון לגוף שלא פרסם אותו. אם אינך בטוח במספר, השמט או רכך. עדיף בלי מספר מאשר מספר שגוי.**

פורמט הפלט המדויק:
שורה ראשונה: SLUG: <slug בעברית, המילים מופרדות במקף, למשל: אופטימיזציית-דפי-מוצר-שופיפיי>
שורה ריקה.
ואז Markdown עם frontmatter (כולל המרכאות):
---
title: "<כותרת בעברית, ממוקדת ומושכת, עד ~60 תווים>"
description: "<תיאור 120-155 תווים>"
pubDate: ${today}
cluster: "${cat.title}"
readingMinutes: <מספר שלם, הערכה כנה 5-9>
demo: false
author: "${AUTHOR_BY_CLUSTER[cat.slug] || 'צוות Scayla'}"
updatedDate: ${today}
takeaways:
  - "<תובנה 1 · משפט מלא>"
  - "<תובנה 2>"
  - "<תובנה 3>"
faq:
  - q: "<שאלה>"
    a: "<תשובה>"
---

<גוף המאמר>

חשוב: אל תוסיף שדה sources (יוזרק אוטומטית). אל תוסיף טקסט מחוץ ל-SLUG ול-Markdown.`

const qaPrompt = (slug, md) => `אתה עורך-בקרה (QA) של מגזין Scayla (SEO/GEO ל-Shopify). המאמר עומד לעלות בלי עין אנושית. מנע "חרטוטים" ושגיאות.

בדוק (השתמש בחיפוש Google לאימות):
1. הטענות והסטטיסטיקות בגוף, אמיתיות ונתמכות במקור אמין? התמקד במספרים, אחוזים, מחקרים, ובייחוס שלהם.
2. אין הבטחות-תוצאה ("דירוג ראשון מובטח", "תוך X ימים"), ואין קו מפריד ארוך (—/–).
3. ה-slug ("${slug}") תקין (מילים בעברית מופרדות במקף), ושם ה-cluster ב-frontmatter הוא אחד מ: ${CLUSTER_NAMES}.
4. עברית תקינה ופורמט נקי. (שדה 'sources' ממולא אוטומטית, אל תפסול פורמט. קישורים פנימיים /magazine/... תקינים.)
5. המאמר לא מוכר את Scayla בכל פסקה, ויש פסקת-פתיחה מודגשת שעונה ישירות.

כללי הכרעה (העדף הצלה על פסילה):
- כמעט תמיד "fixable": אם יש מספר/ציטוט מומצא או לא-מאומת, החזר "fixable" עם הוראה מדויקת להסירו ולהחליף באמירה איכותית.
- "reject" רק אם כל הנחת-היסוד של המאמר שקרית (נדיר).
- "pass" אם הכל מאומת.

החזר אך ורק אובייקט JSON תקין אחד, בלי גדרות \`\`\`, בלי טקסט מסביב:
{"verdict":"pass"|"fixable"|"reject","fabricated":<bool>,"issues":["<בעיה>"],"slugOk":<bool>,"suggestedSlug":"<slug-מתוקן-או-ריק>"}

המאמר:
${md}`

const revisePrompt = (input, issues, suggestedSlug) => `תקן את המאמר אך ורק לפי הערות ה-QA שלמטה. שני סוגי הערות: (א) טענות-עובדה מסומנות (מספרים/ציטוטים) — הסר או רכך; (ב) הערות-לשון ("לשון: ...") — תקן את מה שצוין. **אל תיגע בשום דבר שלא צוין, ואל תשנה עובדות/מבנה.**
חובה לשמר בדיוק: פסקת-הפתיחה המודגשת, כל כותרות ה-H2, בלוק "מה חשוב לזכור", הטבלה, כל הקישורים הפנימיים (/magazine/...), וה-FAQ. שמור אורך ומבנה. אל תמחק סעיפים.
שמור פורמט: שורה ראשונה SLUG:, שורה ריקה, frontmatter + Markdown.

הערות לתיקון:
${issues.map((i) => '- ' + i).join('\n')}
${suggestedSlug ? `\nה-slug חייב להיות: ${suggestedSlug}` : ''}

החזר את המאמר המתוקן המלא בלבד, שמתחיל ב-SLUG:.

המאמר:
${input}`

// ── עיבוד ──
function parseArticle(raw) {
  const text = raw.replace(/```(?:markdown|md)?\s*([\s\S]*?)```/g, '$1')
  const idx = text.search(/^SLUG:\s*\S+/im)
  if (idx === -1) return { slug: '', md: '' }
  const tail = text.slice(idx)
  const slug = (tail.match(/^SLUG:\s*(\S+)/i) || [])[1] || ''
  const md = tail.replace(/^SLUG:\s*\S+\s*/i, '').trim()
  return { slug, md }
}
// slug בעברית: משמר אותיות עבריות/אנגליות/ספרות, מאחד רווחים/מפרידים למקף יחיד.
const sanitizeSlug = (s) => s.replace(/["'`]/g, '').replace(/[^֐-׿a-zA-Z0-9-]+/g, '-').replace(/-+/g, '-').replace(/^-+|-+$/g, '')

function tidyMarkdown(md) {
  return md
    .replace(/(?<=\d)\s*[–—]\s*(?=\d)/g, '-')          // מקף-טווח מספרי (5–7 → 5-7)
    .replace(/(?<![0-9])\s*[—–]\s*(?![0-9])/g, ' · ')  // קו-מפריד ארוך (נראה "AI") → נקודה-מפרידה
    .replace(/ ·(?: ·)+ /g, ' · ')
    .replace(/https?:\/\/(?:www\.)?scayla\.co\.il(\/magazine\/[^\s)"'\]]*)/g, '$1') // קישור-פנים מוחלט → יחסי
    .replace(/(?<!\.)\.\.(?!\.)/g, '.')
    .replace(/\]\(\s+/g, '](')
    .replace(/^([ \t]*[-*])[ \t]*\n(?=\S)/gm, '$1 ')
    .replace(/[ \t]+$/gm, '')
    .replace(/\n{3,}/g, '\n\n')
}

// נרמול-frontmatter (חוסם תקלת-build שקטה): מרכאה-ASCII פנימית → גרש עברי, עטיפה תקינה ב-ASCII.
function fixFmQuotes(md) {
  const parts = md.split(/^---\s*$/m)
  if (parts.length < 3) return md
  const normScalar = (v) => {
    v = v.trim()
    if ((v.startsWith('"') && v.endsWith('"') && v.length > 1) || (v.startsWith('״') && v.endsWith('״') && v.length > 1)) v = v.slice(1, -1)
    v = v.replace(/\\?"/g, '״').replace(/\\([״׳])/g, '$1')
    return '"' + v + '"'
  }
  parts[1] = parts[1].split('\n').map((line) => {
    const m = line.match(/^(\s*(?:- )?(?:title|description|cluster|author|q|a)):\s*(.*\S)\s*$/)
    if (m) return m[1] + ': ' + normScalar(m[2])
    return line
  }).join('\n')
  return parts[0] + '---' + parts[1] + '---' + parts.slice(2).join('---')
}

function looseJson(text) {
  const cleaned = String(text || '').replace(/```(?:json)?\s*([\s\S]*?)```/g, '$1').trim()
  const m = cleaned.match(/\{[\s\S]*\}/)
  if (!m) return null
  const tryParse = (s) => { try { return JSON.parse(s) } catch { return undefined } }
  let o = tryParse(m[0])
  if (o === undefined) o = tryParse(m[0].replace(/,(\s*[}\]])/g, '$1'))
  return o === undefined ? null : o
}

const AUTHORITATIVE = ['developers.google.com', 'schema.org', 'shopify.com', 'web.dev', 'google.com', 'gov.il']
const domainOf = (u) => { try { return new URL(u).hostname.replace(/^www\./, '') } catch { return '' } }
const isAuthoritative = (u) => { const d = domainOf(u); return d && AUTHORITATIVE.some((a) => d === a || d.endsWith('.' + a)) }

const JUNK_TITLE = /just a moment|attention required|you are being redirected|are you a robot|access denied|verify you are human|current time information|enable javascript|momento|cloudflare/i
function cleanTitle(t) {
  t = String(t || '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#0?39;|&apos;|&#x27;/gi, "'").replace(/\s+/g, ' ').replace(/\s*[|–—].*$/, '').trim()
  if (!t || JUNK_TITLE.test(t)) return ''
  if (/�/.test(t) || !/[a-zA-Z֐-׿]/.test(t)) return ''
  return t.length >= 4 && t.length < 90 ? t : ''
}
async function pageTitle(url) {
  try {
    const res = await fetch(url, { redirect: 'follow', headers: { 'user-agent': 'Mozilla/5.0 (compatible; scayla-bot)' } })
    const html = (await res.text()).slice(0, 20000)
    const t = (html.match(/<meta[^>]+property=["']og:title["'][^>]*content=["']([^"']+)["']/i) || [])[1] ||
      (html.match(/<title[^>]*>([^<]+)<\/title>/i) || [])[1] || ''
    return cleanTitle(t)
  } catch { return '' }
}
async function resolveSources(sources) {
  const out = []
  const seen = new Set()
  for (const s of sources.slice(0, 8)) {
    let url = s.url
    if (/grounding-api-redirect/.test(url)) {
      url = null
      for (const opts of [{ method: 'HEAD', redirect: 'manual' }, { method: 'GET', redirect: 'manual' }]) {
        try { const res = await fetch(s.url, opts); const loc = res.headers.get('location'); if (loc && /^https?:\/\//.test(loc)) { url = loc.split('#')[0]; break } } catch { /* next */ }
      }
      if (!url) continue
    }
    if (seen.has(url)) continue
    seen.add(url)
    const title = (await pageTitle(url)) || cleanTitle(s.title) || domainOf(url)
    out.push({ title, url, authoritative: isAuthoritative(url) })
  }
  out.sort((a, b) => (b.authoritative ? 1 : 0) - (a.authoritative ? 1 : 0))
  return out.slice(0, 6).map(({ title, url }) => ({ title, url }))
}
function injectSources(md, sources) {
  if (!sources.length) return md
  const yaml = 'sources:\n' + sources.slice(0, 6).map((s) => `  - title: "${(s.title || s.url).replace(/"/g, "'")}"\n    url: "${s.url}"`).join('\n') + '\n'
  if (/^sources:/m.test(md)) return md.replace(/^sources:[\s\S]*?(?=^---\s*$)/m, yaml)
  return md.replace(/\n---\n/, `\n${yaml}---\n`)
}
// משאיר רק קישורים פנימיים תקינים: /magazine/<slug-קיים> או /magazine/cluster/<אשכול>.
// קישור שבור → מסירים את הקישור ומשאירים את טקסט-העוגן (לא מאבדים תוכן).
function validateLinks(md, validSlugs) {
  return md
    .replace(/\[([^\]]+)\]\(\/magazine\/cluster\/([a-z0-9-]+)\/?\)/g, (m, t, c) => (CLUSTER_SLUGS.has(c) ? `[${t}](/magazine/cluster/${c})` : t))
    .replace(/\[([^\]]+)\]\(\/magazine\/([^\/)]+)\/?\)/g, (m, t, slug) => (validSlugs.has(decodeURIComponent(slug)) ? `[${t}](/magazine/${slug})` : t))
}

// שער-דמיון דטרמיניסטי (Jaccard על מילות כותרת+slug אחרי סינון מילים גנריות).
const SIM_STOP_HE = new Set(['המדריך', 'מדריך', 'המלא', 'שופיפיי', 'לשופיפיי', 'לחנות', 'חנות', 'איך', 'מה', 'למה', 'כמה', 'מתי', 'שלכם', 'שלך', 'כל', 'ומה', 'ואיך', 'עם', 'של', 'על'])
const SIM_STOP_EN = new Set(['guide', 'shopify', 'seo', 'geo', 'store', 'the', 'for', 'how', 'what', 'why', 'when', 'and', 'your', 'ecommerce'])
function simTokens(title, slug) {
  const he = String(title || '').replace(/[^֐-׿\w\s]/g, ' ').split(/\s+/).filter((w) => w.length >= 2 && !SIM_STOP_HE.has(w))
  const en = String(slug || '').split('-').filter((w) => w.length >= 2 && !SIM_STOP_EN.has(w) && !SIM_STOP_HE.has(w))
  return { he: new Set(he), en: new Set(en) }
}
const jaccard = (a, b) => { if (!a.size || !b.size) return 0; const inter = [...a].filter((x) => b.has(x)).length; return inter / (new Set([...a, ...b]).size) }
function mostSimilarArticle(title, slug, arts) {
  const mine = simTokens(title, slug)
  let best = null
  for (const a of arts) {
    if (!a.title && !a.slug) continue
    const theirs = simTokens(a.title, a.slug)
    const score = Math.max(jaccard(mine.he, theirs.he), jaccard(mine.en, theirs.en))
    if (score >= 0.8 && (!best || score > best.score)) best = { slug: a.slug, score }
  }
  return best
}

function setDraft(md, isDraft) {
  if (/^draft:/m.test(md)) return md.replace(/^draft:.*$/m, `draft: ${isDraft}`)
  return md.replace(/^(updatedDate:.*|pubDate:.*)$/m, `$1\ndraft: ${isDraft}`)
}

// התאריך דטרמיניסטי · המכונה קובעת, לא המודל (Gemini לפעמים מזה שנה שחלפה, למשל 2024).
// מקבע pubDate + updatedDate ל-today (ומוסיף אותם אם חסרים).
function stampDates(md, today) {
  let out = md
  out = /^pubDate:/m.test(out) ? out.replace(/^pubDate:.*$/m, `pubDate: ${today}`) : out.replace(/^(cluster:.*)$/m, `pubDate: ${today}\n$1`)
  out = /^updatedDate:/m.test(out) ? out.replace(/^updatedDate:.*$/m, `updatedDate: ${today}`) : out.replace(/^(pubDate:.*)$/m, `$1\nupdatedDate: ${today}`)
  return out
}

// CTA קבוע בסוף הגוף — רך, לא מכירתי. אידמפוטנטי.
const CTA_MARK = 'רוצים לראות איפה החנות שלכם עומדת?'
const CTA_BLOCK = `\n\n---\n\n**${CTA_MARK}** Scayla מודדת את הנראות של החנות בגוגל ובמנועי ה-AI, מאבחנת פערים, ובונה את התוכן שסוגר אותם. [כך זה עובד](/how)\n`
function appendCta(md) {
  if (md.includes(CTA_MARK)) return md
  return md.replace(/\s*$/, '') + CTA_BLOCK
}

// ── QA: fact-check (Gemini), adversarial claims (Gemini/Claude), copy-edit (Gemini) ──
async function qa(slug, md) {
  const { text } = await callGemini(qaPrompt(slug, md), { search: true, maxTokens: 6000, temperature: 0 })
  let o = looseJson(text)
  if (o) return o
  const { text: t2 } = await callGemini(qaPrompt(slug, md) + '\n\nהחזר אך ורק את אובייקט ה-JSON: התו הראשון { והאחרון }, בלי טקסט מסביב.', { search: true, maxTokens: 6000, temperature: 0 }).catch(() => ({ text: '' }))
  o = looseJson(t2)
  if (o) return o
  console.error('⚠ QA parse failed (x2). Raw start:', String(text).slice(0, 140))
  return { verdict: 'fixable', _parseFailed: true, issues: ['בדיקת-העובדות נכשלה טכנית (JSON לא נקרא) — אמת ידנית כל מספר, אחוז וציטוט-בשם מול המקורות לפני פרסום.'] }
}

const claimsPrompt = (slug, md, grounded = []) => {
  const ev = (grounded || []).slice(0, 40).map((t) => `• ${t}`).join('\n').slice(0, 3000)
  const evBlock = ev
    ? `\nהקטעים שהכותב עיגן בפועל בחיפוש (raw grounding) — ראיות-אמת:\n${ev}\n— כל מספר/אחוז/ציטוט בגוף שאינו נתמך באחד מהקטעים ולא נמצא בחיפוש עצמאי → verifiedBySearch:"no", גם אם נשמע סביר.\n`
    : ''
  return `אתה מבקר-עובדות יריב (adversarial fact-checker) של מגזין "Scayla" (SEO/GEO ל-Shopify). המאמר נכתב ע"י מודל אחר, ותפקידך למצוא חרטוטים שהוא לא תופס. אל תאשר הוליסטית, חפש כשלים.

חלץ כל טענה אטומית עם מספר, אחוז, שנה, ייחוס-מקור-בשם, או ציטוט, ואמת כל אחת (סמן "partial" אם אינך בטוח).
כללי-ברזל:
- ציטוט המיוחס לאדם-בשם, או נתון המיוחס לגוף (Google/Shopify/מחקר) ללא מקור תומך ברור → verifiedBySearch:"no".
- לכל מספר/אחוז: בדוק אם בלוק sources: כולל מקור שתומך ישירות. אם לא נמצא תימוכין → verifiedBySearch:"no" + issue: התאם את הייחוס למקור שקיים או רכך לאמירה כללית.
- אסור הבטחת-תוצאה, אסור קו-מפריד ארוך (—/–).
${evBlock}
החזר אך ורק אובייקט JSON אחד, בלי גדרות, בלי טקסט מסביב:
{"verdict":"pass"|"fixable"|"reject","fabricated":<bool>,"claims":[{"claim":"<טקסט>","type":"stat"|"quote"|"attribution"|"date","verifiedBySearch":"yes"|"no"|"partial","note":"<קצר>"}],"issues":["<בעיה + הוראת תיקון>"]}

המאמר:
${md}`
}
async function qaClaude(slug, md, grounded = []) {
  const text = await callClaude(claimsPrompt(slug, md, grounded), { maxTokens: 6000 })
  const o = looseJson(text)
  if (o) return o
  console.error('⚠ Claude QA parse failed. Raw start:', text.slice(0, 160))
  return { verdict: 'pass', _parseFailed: true, issues: [] }
}
async function qaGeminiClaims(slug, md, grounded = []) {
  const { text } = await callGemini(claimsPrompt(slug, md, grounded), { search: true, maxTokens: 6000, temperature: 0 })
  const o = looseJson(text)
  if (o) return o
  console.error('⚠ Gemini-claims QA parse failed. Raw start:', text.slice(0, 140))
  return { verdict: 'pass', _parseFailed: true, issues: [], claims: [] }
}

const copyEditPrompt = (md) => `אתה מגיה ועורך-לשון בכיר של מגזין "Scayla" (SEO/GEO ל-Shopify, עברית, קול איש-מקצוע חם ופרקטי). קרא לאט ובקפדנות ומצא כל שגיאת-לשון אמיתית. אל תיגע בעובדות/מספרים/מבנה — שפה, דקדוק ועקביות בלבד.

עבור על כל אחת מהעדשות:
1. **התאם מין ומספר** (שם-עצם ↔ תואר/פועל/כינוי).
2. **עקביות-מינוח**: אותה ישות = שם אחד בלבד לאורך כל המאמר (מנוע-חיפוש/מנוע-תשובות/פלטפורמה — לא לסירוגין).
3. **עקביות יחיד/רבים בקול**: המאמר פונה לבעלי-חנות ברבים, אל תקפוץ ליחיד באמצע.
4. **משפט שבור / מילה חסרה**: קרא כל משפט וודא שהוא שלם, דקדוקי והגיוני.
5. **פיסוק**: אל תפריד בפסיק בין נושא ארוך לנשוא. סדרה של 3 = "א, ב או ג".
6. **כתיב-מלא תקני**: מיידי (לא מידי), תיאורטי (לא תאורטי), אחראים (לא אחראיים).
7. **כפילות/מריחה**: משפט/רעיון שחוזר ברצף = מיותר.
8. **כללי-ברזל**: בלי הבטחות-תוצאה; בלי קו-מפריד ארוך (—/–); עברית בלבד.
9. **מותגים** (גלוסר למטה): שים לב לבלבול בין מנוע-חיפוש למנוע-תשובות, ובין פלטפורמה לכלי.

${glossaryForPrompt()}

אל תשנה כותרת בעצמך, אבל אם יש בה שגיאה (כולל בלבול מותג) — דווח כ-issue עם התיקון.
החזר אך ורק אובייקט JSON אחד תקין (התו הראשון { והאחרון }, בלי גדרות ובלי טקסט מסביב). כל issue = מחרוזת קצרה: הציטוט השגוי → התיקון. ברח ממרכאות-כפולות בערכים (גרש עברי ״):
{"hasIssues":<bool>,"issues":["<ציטוט שגוי → תיקון מדויק>"]}

המאמר:
${md}`
function normIssues(arr) {
  return (arr || []).map((i) => (typeof i === 'string' ? i : (i.fix || i.suggestion || i.suggest || i.issue || JSON.stringify(i)))).filter(Boolean)
}
async function qaCopyEdit(md) {
  const { text } = await callGemini(copyEditPrompt(md), { maxTokens: 8000, temperature: 0, thinkingBudget: 512 })
  let o = looseJson(text)
  if (!o) {
    const { text: t2 } = await callGemini(copyEditPrompt(md) + '\n\nהחזר אך ורק את אובייקט ה-JSON, התו הראשון { והאחרון }.', { maxTokens: 8000, temperature: 0, thinkingBudget: 512 }).catch(() => ({ text: '' }))
    o = looseJson(t2)
  }
  if (o) { o.issues = normIssues(o.issues); return o }
  console.error('⚠ copy-edit QA parse failed (x2). Raw start:', text.slice(0, 140))
  return { hasIssues: false, issues: [], _parseFailed: true }
}

// ── בקרה דטרמיניסטית (regex, 0-עלות) ──
function lintArticle(md) {
  const issues = []
  // הבטחת-תוצאה (המקבילה של איסור "חינם" בבנק-קט) — פוגעת באמינות ובציות.
  if (/דירוג ראשון מובטח|מובטח\s+דירוג|תוצאות מובטחות|אנחנו מבטיחים|מבטיחים דירוג|תוך \d+ ימים תדורגו/.test(md)) {
    issues.push('הסר הבטחת-תוצאה ("מובטח"/"תוך X ימים") — SEO/GEO תלוי בגורמים רבים; רכך לעיקרון/הסתברות.')
  }
  const body = md.replace(/^---[\s\S]*?^---\s*$/m, '')
  if (/[—–]/.test(body)) issues.push('הסר קו-מפריד ארוך (—/–), החלף בפסיק/נקודה-מפרידה.')
  const fm = (md.match(/^---[\s\S]*?\n---/) || [''])[0]
  const fmBroken = /\\"/.test(fm) || /\\[״׳]/.test(fm)
  if (fmBroken) issues.push('frontmatter שובר YAML (מרכאה עם backslash) — החלף בגרש עברי ״ בלי backslash.')
  const titleLen = ((md.match(/^title:\s*"([^"]*)"/m) || [])[1] || '').trim().length
  const titleBad = titleLen < 8
  if (titleBad) issues.push('כותרת קצרה/פגומה — צור כותרת עברית מלאה 25-65 תווים במרכאות-כפולות.')
  const bodyTrim = body.trim()
  const contentTrim = (bodyTrim.split(CTA_MARK)[0] || '').replace(/[\s*_-]+$/, '')
  const truncBody = contentTrim.length > 0 && !/[.!?…"'׳״)\]|>]\s*$/.test(contentTrim)
  const tplRaw = /\{\%|\{\{/.test(body)
  const brokenLink = /\[\/[^\]\n]*\]/.test(body) || /\]\([^)\n]*\{\{/.test(body)
  if (tplRaw) issues.push('קוד-תבנית גולמי ({% / {{) בגוף — החלף בתוכן בפועל.')
  if (brokenLink) issues.push('קישור Markdown שבור — תקן לתחביר [טקסט](/path).')
  const emptyTail = /##+[^\n]*\n+\s*$/.test(contentTrim)
  if (truncBody || emptyTail) issues.push('הגוף קטוע — נגמר באמצע משפט/טבלה או בכותרת ריקה. השלם עד סוף מלא (כולל "## מה חשוב לזכור").')
  if (!/##+\s*מה חשוב לזכור/.test(body)) issues.push('חסר סעיף "## מה חשוב לזכור" עם 3-4 נקודות תמצית.')
  if (/##+\s*שאלות נפוצות/.test(body)) issues.push('הסר את סעיף "## שאלות נפוצות" מהגוף — ה-FAQ נכנס רק לשדה faq.')
  const factIssues = lintFacts(md)
  issues.push(...factIssues)
  const bodyWords = contentTrim ? contentTrim.split(/\s+/).filter(Boolean).length : 0
  const thin = bodyWords > 0 && bodyWords < 700
  if (thin) issues.push(`הגוף ${bodyWords} מילים — היעד 900-1,200. המאמר דק מדי; העמק בלי למרוח.`)
  const truncated = truncBody || emptyTail || thin
  const fmYamlBroken = !fmParses(md)
  if (fmYamlBroken) issues.push('frontmatter לא נתיח כ-YAML — עטוף כל ערך במרכאות-כפולות ASCII, והמר מרכאה-פנימית לגרש עברי ״.')
  const broken = tplRaw || brokenLink || fmBroken || fmYamlBroken
  return { issues, titleBad, truncated, broken, factWrong: factIssues.length > 0 }
}

// ── run ──
try {
  const today = new Date().toISOString().slice(0, 10)
  const { arts, counts } = scanArticles()
  const flag = (name) => { const a = process.argv.find((x) => x.startsWith(`--${name}=`)); return a ? a.slice(name.length + 3) : '' }
  const cliTopic = flag('topic')
  const cliSeeds = (flag('seed') || flag('seeds')).split(',').map((s) => s.trim()).filter(Boolean)
  let cat, topicHint, planKeyword = null, seedUrls = cliSeeds
  if (process.argv[2] && !process.argv[2].startsWith('--')) {
    cat = CLUSTER_BY_SLUG[process.argv[2]]; topicHint = cliTopic || ''
    if (!cat) { result({ status: 'error', reason: `unknown cluster ${process.argv[2]}` }); process.exit(1) }
  } else {
    const picked = pickTopic(counts); cat = picked.cat; topicHint = cliTopic || picked.brief; planKeyword = picked.fromPlan ? picked.keyword : null
    if (!seedUrls.length && picked.seeds && picked.seeds.length) seedUrls = picked.seeds
  }
  const related = relatedList(cat, arts, 6)

  console.error(`→ [1/3] research brief: "${topicHint || cat.title}" on ${MODEL}${seedUrls.length ? ` [${seedUrls.length} seed URLs]` : ''}…`)
  const existingTitles = [
    ...arts.filter((a) => a.cluster === cat.slug).map((a) => a.title),
    ...arts.filter((a) => a.cluster !== cat.slug).map((a) => a.title).slice(0, 25),
  ].filter(Boolean)
  // הקריאה ה-grounded של 2.5 Pro מדי-פעם חוזרת ריקה (ה"חשיבה" בולעת את התקציב, transient).
  // retry עד 3 פעמים לפני כניעה — זול, ומונע כשל-סרק על נושא תקין (תיקון Scayla, לא קיים בבנק-קט).
  let briefRes = { text: '' }
  for (let attempt = 1; attempt <= 3; attempt++) {
    briefRes = await callGemini(briefPrompt(cat, topicHint, seedUrls, existingTitles), { search: true, maxTokens: 6000, temperature: 0.5 })
    if (briefRes.text && briefRes.text.length >= 80) break
    console.error(`  ⚠ empty/short brief (attempt ${attempt}/3), retrying…`)
  }
  if (!briefRes.text || briefRes.text.length < 80) { result({ status: 'error', cluster: cat.slug, reason: 'empty brief after 3 attempts' }); process.exit(1) }

  console.error(`→ [2/3] write (grounded, related links: ${related ? related.split('\n').length : 0})…`)
  const writeRes = await callGemini(writePrompt(cat, briefRes.text, related, today), { search: true, maxTokens: 12000, temperature: 0.7 })
  const grounded = [...(briefRes.grounded || []), ...(writeRes.grounded || [])]
  let { slug, md } = parseArticle(writeRes.text)
  if (!slug || !md.startsWith('---') || md.split(/^---\s*$/m).length < 3) { result({ status: 'error', cluster: cat.slug, reason: 'write parse failed or truncated' }); process.exit(1) }

  const validSlugs = new Set(arts.map((a) => a.slug))
  const allSources = await resolveSources([...writeRes.sources, ...briefRes.sources])
  const assemble = (m) => appendCta(normalizeBrands(fixFmQuotes(validateLinks(injectSources(tidyMarkdown(m), allSources), validSlugs))).md)
  md = assemble(md)

  const lint = lintArticle(md)
  let issues = [...lint.issues]
  let suggestedSlug = ''
  let forcedDraft = false

  console.error(`→ [3/3] QA: Gemini fact-check + adversarial-claims + copy-edit${QA_CLAUDE_MODEL ? ' + Claude (cross-family)' : ''}… [${allSources.length} sources, ${grounded.length} grounded]`)
  const [v, cp, gc, c] = await Promise.all([
    qa(slug, md),
    qaCopyEdit(md).catch((e) => { console.error('⚠ copy-edit QA error:', String(e).slice(0, 120)); return null }),
    qaGeminiClaims(slug, md, grounded).catch((e) => { console.error('⚠ Gemini-claims QA error:', String(e).slice(0, 120)); return null }),
    QA_CLAUDE_MODEL ? qaClaude(slug, md, grounded).catch((e) => { console.error('⚠ Claude QA error, Gemini-only:', String(e).slice(0, 120)); return null }) : Promise.resolve(null),
  ])

  if (v.verdict === 'reject') {
    console.error('✗ QA reject (unsalvageable):', JSON.stringify(v.issues || []))
    markDone(planKeyword)
    result({ status: 'skipped', cluster: cat.slug, slug, reason: (v.issues || ['QA reject']).join('; ') }); process.exit(0)
  }
  if (v._parseFailed) forcedDraft = true
  if (v.verdict === 'fixable' || v.fabricated) issues.push(...(v.issues || []))
  if (v.slugOk === false) suggestedSlug = v.suggestedSlug || ''

  if (c) {
    if (c._parseFailed) forcedDraft = true
    else {
      if (c.verdict === 'reject') { forcedDraft = true; console.error('⚠ Claude reject (Gemini did not) — banking for human glance') }
      issues.push(...(c.issues || []), ...((c.claims || []).filter((x) => x.verifiedBySearch === 'no').map((x) => `הסר או רכך טענה לא-מאומתת: ${x.claim}`)))
    }
  }
  if (gc) {
    if (gc._parseFailed) forcedDraft = true
    else {
      if (gc.verdict === 'reject') { forcedDraft = true; console.error('⚠ Gemini-claims reject — banking for human glance') }
      issues.push(...(gc.issues || []), ...((gc.claims || []).filter((x) => x.verifiedBySearch === 'no').map((x) => `הסר או רכך טענה לא-מאומתת: ${x.claim}`)))
    }
  }
  if (cp) {
    if (cp._parseFailed) forcedDraft = true
    else if (cp.hasIssues) issues.push(...(cp.issues || []).map((i) => `לשון: ${i}`))
  }

  issues = [...new Set(issues.filter(Boolean))]
  let qaNote = forcedDraft ? 'forced-draft' : (issues.length ? 'fixable' : 'pass')
  if (issues.length || suggestedSlug) {
    console.error(`→ revising per QA (${issues.length} issues${suggestedSlug ? ', + slug' : ''})…`)
    const r = parseArticle((await callGemini(revisePrompt(`SLUG: ${suggestedSlug || slug}\n\n${md}`, issues, suggestedSlug), { maxTokens: 12000, temperature: 0.3 })).text)
    if (r.slug && r.md.startsWith('---')) {
      slug = r.slug; md = assemble(r.md); qaNote = 'fixed'
      const rl = lintArticle(md)
      const lintHard = rl.titleBad || rl.truncated || rl.broken || rl.factWrong
      if (QA_CLAUDE_MODEL) {
        const rc = await qaClaude(slug, md, grounded).catch(() => null)
        const rcRan = rc && !rc._parseFailed
        if ((rcRan && rc.verdict === 'reject') || lintHard) { forcedDraft = true; qaNote = 'fixed-needs-glance' }
      } else {
        const rq = await qaGeminiClaims(slug, md, grounded).catch(() => null)
        const rqRan = rq && !rq._parseFailed
        const claimsBad = rqRan && (rq.verdict === 'reject' || (rq.claims || []).some((x) => x.verifiedBySearch === 'no'))
        if (claimsBad || lintHard) { forcedDraft = true; qaNote = 'fixed-needs-glance' }
      }
    } else {
      forcedDraft = true; qaNote = 'revise-failed'
    }
  }

  slug = sanitizeSlug(slug)
  if (!slug) { result({ status: 'error', cluster: cat.slug, reason: 'empty slug' }); process.exit(1) }
  let outPath = join(ARTICLES_DIR, `${slug}.md`)
  let dupOf = ''
  if (existsSync(outPath)) {
    dupOf = slug
    let n = 2; while (existsSync(join(ARTICLES_DIR, `${slug}-${n}.md`))) n++
    slug = `${slug}-${n}`; outPath = join(ARTICLES_DIR, `${slug}.md`)
    forcedDraft = true; qaNote = `slug-collision:${dupOf}`
    console.error(`⚠ slug collision with existing "${dupOf}" — near-certain duplicate; holding for review`)
  }
  if (!dupOf) {
    const newTitle = (md.match(/^title:\s*"([^"]*)"/m) || [])[1] || ''
    const sim = mostSimilarArticle(newTitle, slug, arts)
    if (sim) {
      forcedDraft = true; qaNote = `title-similar:${sim.slug}`
      dupOf = sim.slug
      console.error(`⚠ title/slug similarity ${sim.score.toFixed(2)} with "${sim.slug}" — holding for review`)
    }
  }
  const publishNow = PUBLISH_NOW && !forcedDraft
  md = setDraft(md, !publishNow)
  // ה-verdict של ה-QA חייב להיכתב ב-frontmatter, אחרת ה-drip מפרסם גם מאמרים שה-QA החזיק.
  // needsReview:true = ה-drip מדלג, מוחזק לעין אנושית. שחרור: מוחקים את השורה.
  if (forcedDraft) md = md.replace(/^draft: true\s*$/m, `draft: true\nneedsReview: true`)
  md = stampDates(md, today) // תאריך דטרמיניסטי · המכונה קובעת, לא המודל
  const title = (md.match(/^title:\s*"([^"]*)"/m) || [])[1] || ''
  const description = (md.match(/^description:\s*"([^"]*)"/m) || [])[1] || ''
  if (!fmParses(md)) {
    console.error('✗ frontmatter YAML invalid after assembly+QA — skipping (build-safety guard)')
    markDone(planKeyword)
    result({ status: 'skipped', cluster: cat.slug, slug, reason: 'frontmatter YAML invalid (build-safety guard)' }); process.exit(0)
  }
  writeFileSync(outPath, md.endsWith('\n') ? md : md + '\n')
  markDone(planKeyword)
  console.error(`✓ wrote ${slug}.md  (draft:${!publishNow}${forcedDraft ? ' [forced]' : ''}, qa:${qaNote}, ${CALLS} model calls)`)
  // תמונת-שער (hero) בסגנון-בית · best-effort, כשל לא חוסם את המאמר (ה-hero נופל לרקע כהה).
  // בהצלחה: מזריקים coverImage ל-frontmatter כדי שגם כרטיסי-הבלוג וגם ה-OG (שיתוף) ישתמשו בו.
  let coverPath = null
  try {
    const { generateCover } = await import('./gen-cover.mjs')
    coverPath = await generateCover({ slug, title })
    if (coverPath) {
      let cur = readFileSync(outPath, 'utf8')
      if (!/^coverImage:/m.test(cur)) {
        cur = cur.replace(/^(pubDate:.*)$/m, `$1\ncoverImage: "${coverPath}"`)
        writeFileSync(outPath, cur)
      }
      console.error(`✓ cover ${coverPath}`)
    }
  } catch (e) { console.error('  ✗ cover error:', String(e).slice(0, 120)) }
  result({
    status: publishNow ? 'published' : 'banked', cluster: cat.slug, slug, title, description,
    url: `https://scayla.co.il/magazine/${slug}`, qa: qaNote, model: MODEL,
    claudeQa: c ? (c.verdict || (c._parseFailed ? 'parsefail' : '')) : 'off',
    copyQa: cp ? (cp._parseFailed ? 'parsefail' : (cp.hasIssues ? `${(cp.issues || []).length} fixes` : 'clean')) : 'err',
    forcedDraft, dupOf: dupOf || undefined,
    sources: allSources.length, calls: CALLS,
    qaWarning: forcedDraft ? `נשמר כטיוטה לבדיקה (${qaNote})` : (v._parseFailed ? 'QA JSON parse failed (please glance)' : ''),
  })
} catch (e) {
  console.error('machine error:', String(e))
  result({ status: 'error', reason: String(e).slice(0, 200) })
  process.exit(1)
}
