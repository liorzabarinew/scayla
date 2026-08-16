#!/usr/bin/env node
// enrich-demand.mjs — מחקר מילות-מפתח סביב הנושאים הקיימים, ולא עליהם.
//
// למה זה קיים
// ───────────
// השער שנבנה קודם מדד את *המחרוזת של הנושא*: לקח "קישור פנימי אוטומטי שופיפיי",
// שאל את גוגל בדיוק על הצירוף הזה, קיבל 0, ופסל. זו לא מדידה של ביקוש — זו
// מדידה של ניסוח. בעברית כמעט כל לונג-טייל ספציפי מחזיר 0 ב-Keyword Planner,
// גם כשהנושא עצמו מבוקש היטב תחת ניסוח אחר.
//
// הוכחה שהריצה הזו נשענת עליה: הזרעה בביטוי המלא "קישור פנימי אוטומטי שופיפיי"
// החזירה אפס רעיונות. פירוק לזרעי-ליבה ("קישור פנימי" + "שופיפיי") החזיר 48.
// אותו נושא בדיוק, אותו API — ההבדל היחיד הוא איך שאלנו.
//
// איך זה עובד
// ───────────
// 1. מפרק כל נושא לזרעי-ליבה: מסיר מילות-קישור, שומר צירופים בעלי משמעות.
// 2. מאחד את כל הזרעים מכל הנושאים לרשימה אחת ומריץ אותה בבאצ'ים — מאגר מדוד
//    אחד לכולם. ~8 קריאות API במקום קריאה לכל נושא.
// 3. לכל נושא בוחר מהמאגר את הביטוי עם החפיפה הסמנטית הגבוהה ביותר, מבין אלה
//    שעומדים בסף ובמסנני הכוונה.
// 4. כותב חזרה head + volume. הנושא שומר על הניסוח שלו כ-keyword; ה-head הוא
//    העוגן המדוד שמצדיק אותו.
//
// קריאה בלבד מול Ads. הרצה: node scripts/enrich-demand.mjs [--write]
import { readFileSync, writeFileSync, copyFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
import { keywordIdeas } from '../lib/ads-keywords.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const TOPICS = join(ROOT, 'scripts/topics.json')
const WRITE = process.argv.includes('--write')

const MIN_VOL = Number(process.env.MIN_ADS_VOLUME || 30)
const MAX_VOL = Number(process.env.MAX_HEAD_VOLUME || 5000)

// מילים שלא נושאות משמעות חיפושית · זרע שמכיל אותן בלבד יחזיר רעש.
const STOP = new Set(['של', 'עם', 'על', 'את', 'מול', 'בין', 'לפי', 'כמו', 'איך', 'מה', 'למה', 'מתי',
  'כמה', 'האם', 'זה', 'זו', 'הוא', 'היא', 'הם', 'לא', 'כן', 'רק', 'גם', 'או', 'ואז', 'אבל',
  'בלי', 'תוך', 'אחרי', 'לפני', 'מדריך', 'המדריך', 'שלב', 'צעד', 'טיפים', 'הסבר', 'מלא', 'המלא',
  'שלכם', 'שלנו', 'שלך', 'ל', 'ב', 'מ', 'ה', 'ו', 'the', 'for', 'and', 'to', 'in', 'of', 'a'])

// עוגנים שתמיד שווה להזריע לצד מילות הנושא · הם מביאים את הראש של התחום.
const ANCHORS = {
  'geo-ai': ['בינה מלאכותית', 'chatgpt', 'קידום אורגני'],
  'seo-shopify': ['שופיפיי', 'קידום אתרים', 'seo'],
  ecommerce: ['חנות אונליין', 'איקומרס', 'מכירות אונליין'],
  guides: ['מחקר מילות מפתח', 'כלי seo', 'קידום אתרים'],
}

// כוונת-שכירה וורטיקלים זרים · זהה לרשימה ב-idea-engine.
const REJECT = [/חבר[הת]\s/, /מומחה/, /סוכנות/, /משרד/, /מחיר/, /עלות/, /כמה עולה/, /קורס/, /לימוד/,
  /דרוש/, /משרה/, /פרילנס/, /מנהל/, /freelanc/i, /agency/i, /jobs?\b/i,
  /עורכי דין|רופא|מרפא|נדל"ן|נדלן|מסעד|קליניק|רואה חשבון|ביטוח/]

const norm = (s) => String(s || '').trim().toLowerCase().replace(/["'׳״]/g, '').replace(/\s+/g, ' ')
const words = (s) => norm(s).split(/[\s\-–—,.:;()\[\]/]+/).filter((w) => w.length > 1 && !STOP.has(w))

/**
 * זרעי-ליבה לנושא · צמדים בלבד, אף פעם לא מילה בודדת.
 *
 * מילה עברית בודדת מחוץ להקשר מושכת קורפוס שלם ולא-קשור: "עוגיות" (מהנושא
 * "שיווק ללא עוגיות צד ג") החזירה "עוגיות ללא גלוטן"; "משלוחים" החזירה שאילתות
 * צרכניות; "דפדפן" החזירה השוואות דפדפנים. הצמד שומר את ההקשר.
 */
function seedsFor(topic) {
  const w = words(`${topic.keyword || ''} ${topic.title || ''}`)
  const out = new Set()
  for (let i = 0; i < w.length - 1; i++) out.add(`${w[i]} ${w[i + 1]}`)
  return [...out].slice(0, 5)
}

// מונחי התחום. מועמד שאינו נוגע באף אחד מהם אינו העוגן שלנו — גם אם הוא
// חולק מילים עם הנושא ויש לו נפח אמיתי. זה מה שמפריד בין "עוגיות צד שלישי"
// לבין "עוגיות ללא גלוטן".
const DOMAIN = ['שופיפיי', 'shopify', 'וורדפרס', 'wordpress', 'חנות', 'חנויות', 'איקומרס',
  'ecommerce', 'אונליין', 'seo', 'geo', 'aeo', 'קידום', 'אורגני', 'גוגל', 'google', 'חיפוש',
  'דירוג', 'אינדוקס', 'סכמה', 'schema', 'מטא', 'מילות מפתח', 'תנועה', 'המרה', 'המרות',
  'דף מוצר', 'קטגוריה', 'קישורים', 'קישור פנימי', 'אתר', 'אתרים', 'תוכן', 'בלוג',
  'chatgpt', 'gemini', 'perplexity', 'בינה מלאכותית', 'מכירות אונליין', 'דרופשיפינג']

/**
 * קרבה בין נושא למועמד.
 *
 * Jaccard סימטרי נכשל כאן ונתן תוצאות אבסורדיות: מועמד בן מילה אחת כמו "b2b"
 * או "דפדפן" קיבל ציון גבוה, כי מילה משותפת אחת מתוך איחוד קטן היא יחס גבוה.
 * "מכירה סיטונאית בשופיפיי" נצמד ל-"b2b" עם 4,400 חיפושים · מספר אמיתי שלא
 * אומר כלום על הנושא.
 *
 * שתי דרישות מתקנות את זה:
 *   · מועמד חייב לפחות שתי מילות-תוכן — עוגן חייב להיות ביטוי, לא מילה
 *   · חייבות לפחות שתי מילים משותפות — חפיפה אחת היא מקריות
 * הציון עצמו הוא *כיסוי המועמד*: כמה ממנו מוסבר ע"י הנושא. זה מעדיף עוגן
 * ספציפי שהנושא באמת מכסה, על פני ראש רחב שרק נוגע בו.
 */
function relatedness(subject, candidate) {
  const A = new Set(words(subject)), B = words(candidate)
  if (B.length < 2) return 0
  const shared = B.filter((w) => A.has(w))
  if (shared.length < 2) return 0
  return (shared.length / B.length) * Math.min(B.length, 4)
}

async function main() {
  const topics = JSON.parse(readFileSync(TOPICS, 'utf8'))
  console.log(`נושאים בתור: ${topics.length}`)

  // ── מאגר מדוד אחד לכולם ────────────────────────────────────────────────
  const seedSet = new Set()
  for (const t of topics) {
    for (const s of seedsFor(t)) seedSet.add(s)
    for (const a of ANCHORS[t.cluster] || []) seedSet.add(a)
  }
  const seeds = [...seedSet]
  console.log(`זרעים ייחודיים: ${seeds.length} · ${Math.ceil(seeds.length / 20)} קריאות API`)

  const POOL_FILE = join(ROOT, '.cache', 'demand-pool.json')
  let pool = new Map()
  if (!process.argv.includes('--fresh')) {
    try { pool = new Map(Object.entries(JSON.parse(readFileSync(POOL_FILE, 'utf8')))) } catch { /* אין מטמון */ }
  }
  if (pool.size) { console.log(`מאגר מהמטמון: ${pool.size} ביטויים (--fresh לרענון)`); seeds.length = 0 }
  for (let i = 0; i < seeds.length; i += 20) {
    const batch = seeds.slice(i, i + 20)
    const ideas = await keywordIdeas(batch, { market: 'IL', limit: 400 })
    for (const idea of ideas) if (idea.keyword) pool.set(norm(idea.keyword), idea.volume)
    process.stdout.write(`\r  מאגר: ${pool.size} ביטויים מדודים (${Math.min(i + 20, seeds.length)}/${seeds.length})   `)
  }
  if (seeds.length) {
    try {
      const { mkdirSync } = await import('node:fs')
      mkdirSync(join(ROOT, '.cache'), { recursive: true })
      writeFileSync(POOL_FILE, JSON.stringify(Object.fromEntries(pool)))
    } catch { /* best effort */ }
    console.log(`\nמאגר סופי: ${pool.size} ביטויים`)
  }

  // רק ביטויים שמישים: בטווח, ולא כוונת-שכירה.
  const usable = [...pool.entries()]
    .filter(([k, v]) => v >= MIN_VOL && v <= MAX_VOL
      && !REJECT.some((re) => re.test(k))
      && DOMAIN.some((d) => k.includes(d)))
  console.log(`שמישים אחרי סף ומסנני כוונה: ${usable.length}`)

  // ── הצמדה ──────────────────────────────────────────────────────────────
  let matched = 0, unmatched = []
  for (const t of topics) {
    if (!t || !t.keyword) continue
    const subject = `${t.keyword} ${t.title || ''}`
    let best = null, bestScore = 0
    for (const [k, v] of usable) {
      const ov = relatedness(subject, k)
      if (ov <= 0) continue
      // קרבה קובעת, נפח רק שובר שוויון · אחרת כל נושא היה נצמד ל"שופיפיי".
      const score = ov * 1000 + Math.log10(v + 1)
      if (score > bestScore) { bestScore = score; best = { k, v, ov } }
    }
    if (best) {
      t.head = best.k
      t.volume = best.v
      t.demandSource = 'ads'
      t.headOverlap = Math.round(best.ov * 100) / 100
      matched++
    } else {
      unmatched.push(t.keyword)
    }
  }

  console.log(`\n── תוצאה ──`)
  console.log(`הוצמד עוגן מדוד: ${matched}/${topics.length}`)
  console.log(`בלי שום ביטוי קשור: ${unmatched.length}`)
  const vols = topics.filter((t) => typeof t.volume === 'number').map((t) => t.volume).sort((a, b) => a - b)
  if (vols.length) {
    console.log(`נפח · חציון ${vols[Math.floor(vols.length / 2)]} · מינ' ${vols[0]} · מקס' ${vols[vols.length - 1]}`)
  }
  console.log(`\n8 החזקים:`)
  for (const t of [...topics].filter((t) => t.volume).sort((a, b) => b.volume - a.volume).slice(0, 8)) {
    console.log(`  ${String(t.volume).padStart(5)} · ${String(t.head).padEnd(22)} ← ${t.keyword}`)
  }
  if (unmatched.length) console.log(`\nללא עוגן (דוגמאות): ${unmatched.slice(0, 6).join(' | ')}`)

  if (WRITE) {
    copyFileSync(TOPICS, TOPICS + '.bak')
    topics.sort((a, b) => (typeof b?.volume === 'number' ? b.volume : -1) - (typeof a?.volume === 'number' ? a.volume : -1))
    writeFileSync(TOPICS, JSON.stringify(topics, null, 2))
    console.log(`\n✓ נכתב ל-topics.json (גיבוי: topics.json.bak) · ממוין לפי ביקוש`)
  } else {
    console.log(`\n(הרצת יבש · להחלה: --write)`)
  }
}

main().catch((e) => { console.error('נכשל:', e.message); process.exit(1) })
