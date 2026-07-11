#!/usr/bin/env node
// ──────────────────────────────────────────────────────────────────────────
// integrity-audit.mjs — ביקורת שלמות לילית (אזעקת-דריפט) למאגר התוכן של Scayla.
//
// סורק את src/content/magazine ומדווח על הפרות אינווריאנטים — בלי שום קריאת-API
// חיצונית (fs + regex בלבד). המכונה כותבת; זה השומר ששום דבר לא נרקב בשקט:
//   1. כותרות כפולות / כמעט-כפולות (נורמליזציה + דמיון-אסימונים).
//   2. draft:true או needsReview:true שמבוגר מ-10 ימים ("מאגר מתקלקל").
//   3. frontmatter שבור/לא-חוקי (שדות-חובה חסרים · cluster לא מ-4 · readingMinutes לא-שלם).
//   4. קישורים פנימיים ל-slug שלא קיים.
//   5. מקורות עם כותרת של דף-שגיאה (403/404/forbidden/access denied).
// בנוסף: סיכום מצב-בנק (פורסמו פר-אשכול · טיוטות מוחזקות).
//
// שקט = בריאות: notify() לטלגרם רק כשיש הפרות. RESULT:{json} תמיד לפלט.
// יציאה != 0 רק על כשל קשה (למשל תיקיית-מאמרים חסרה).
// הרצה: node scripts/integrity-audit.mjs
// ──────────────────────────────────────────────────────────────────────────

import { readFileSync, readdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'
import { createRequire } from 'module'
import { notify } from './notify.mjs'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const ARTICLES_DIR = join(ROOT, 'src/content/magazine')

// ספי-כוונון
const ROT_DAYS = 10           // draft/needsReview מבוגר מזה = "מתקלקל"
const NEAR_DUP_SIM = 0.86     // דמיון-אסימונים שמעליו כותרות נחשבות כמעט-כפולות

// 4 האשכולות המדויקים (כותרת = הערך ב-frontmatter · slug = ה-URL).
const CLUSTERS = [
  { slug: 'geo-ai', title: 'GEO ואופטימיזציה למנועי AI' },
  { slug: 'seo-shopify', title: 'SEO לחנויות שופיפיי' },
  { slug: 'ecommerce', title: 'שיווק לאיקומרס ישראלי' },
  { slug: 'guides', title: 'מדריכים וכלים' },
]
const CLUSTER_BY_TITLE = Object.fromEntries(CLUSTERS.map((c) => [c.title, c]))
const CLUSTER_SLUGS = new Set(CLUSTERS.map((c) => c.slug))
const VALID_CLUSTER_TITLES = new Set(CLUSTERS.map((c) => c.title))

function result(obj) { console.log('RESULT:' + JSON.stringify(obj)) }

// js-yaml (תלות מוצהרת) לפירוק-frontmatter אמין. אם לא נטען — נופלים ל-regex גס.
let _yaml = null
try { _yaml = createRequire(import.meta.url)('js-yaml') } catch (e) { console.error('⚠ js-yaml failed to load — falling back to regex frontmatter:', String(e).slice(0, 120)) }

// ── נורמליזציית-כותרת: הסרת ניקוד, פיסוק, רווחים כפולים · lower ל-ASCII ──
function normTitle(s) {
  return String(s || '')
    .replace(/[֑-ׇ]/g, '')          // ניקוד/טעמים עבריים
    .toLowerCase()
    .replace(/["'׳״`.,:;!?()\[\]{}<>|/\\־–—-]/g, ' ') // פיסוק (כולל מקף עברי)
    .replace(/\s+/g, ' ')
    .trim()
}
// דמיון Jaccard על קבוצות-אסימונים (לזיהוי כמעט-כפולות).
function tokenSim(a, b) {
  const A = new Set(normTitle(a).split(' ').filter(Boolean))
  const B = new Set(normTitle(b).split(' ').filter(Boolean))
  if (!A.size || !B.size) return 0
  let inter = 0
  for (const t of A) if (B.has(t)) inter++
  return inter / (A.size + B.size - inter)
}

// ── פירוק frontmatter (גוש בין ---) ──
function parseFrontmatter(md) {
  const m = String(md).match(/^---\n([\s\S]*?)\n---/)
  if (!m) return { ok: false, fm: null, raw: '' }
  const raw = m[1]
  if (_yaml) {
    try { return { ok: true, fm: _yaml.load(raw) || {}, raw } }
    catch (e) { return { ok: false, fm: null, raw, err: String(e.message || e).slice(0, 140) } }
  }
  // fallback גס — רק שדות שטוחים (מספיק לזיהוי שדות-חובה חסרים)
  const fm = {}
  for (const line of raw.split('\n')) {
    const mm = line.match(/^([a-zA-Z]+):\s*(.*)$/)
    if (mm) fm[mm[1]] = mm[2].replace(/^["']|["']$/g, '')
  }
  return { ok: true, fm, raw }
}

// גיל בימים מ-pubDate (או null אם לא ניתן לפרש).
function ageDays(pubDate) {
  if (!pubDate) return null
  const d = new Date(pubDate)
  if (isNaN(d.getTime())) return null
  return Math.floor((Date.now() - d.getTime()) / 86_400_000)
}

// כותרות-דף-שגיאה במקורות — regex על טקסט הכותרת.
const ERROR_TITLE_RE = /\b(403|404|forbidden|not\s*found|access\s*denied|page\s*not\s*found|error\s*\d{3}|unauthorized|bad\s*gateway|service\s*unavailable|just\s*a\s*moment|are\s*you\s*a\s*human|attention\s*required)\b/i

function truthy(v) { return v === true || v === 'true' }

function main() {
  if (!existsSync(ARTICLES_DIR)) {
    result({ ok: false, fatal: 'ARTICLES_DIR missing: ' + ARTICLES_DIR })
    console.error('FATAL: articles dir not found:', ARTICLES_DIR)
    process.exit(1)
  }

  const files = readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.md'))
  const arts = []
  const violations = {
    duplicateTitles: [],   // כותרות זהות אחרי נורמליזציה
    nearDuplicateTitles: [],
    rotting: [],           // draft/needsReview ישן
    brokenFrontmatter: [], // YAML שבור / שדות-חובה / cluster / readingMinutes
    brokenInternalLinks: [],
    errorSources: [],
  }

  const slugSet = new Set(files.map((f) => f.replace(/\.md$/, '')))
  const REQUIRED = ['title', 'description', 'pubDate', 'cluster', 'readingMinutes']

  for (const f of files) {
    const slug = f.replace(/\.md$/, '')
    let txt = ''
    try { txt = readFileSync(join(ARTICLES_DIR, f), 'utf8') } catch (e) {
      violations.brokenFrontmatter.push({ slug, issues: ['unreadable: ' + String(e.message || e).slice(0, 80)] })
      continue
    }
    const body = txt.replace(/^---\n[\s\S]*?\n---/, '')
    const { ok, fm, err } = parseFrontmatter(txt)

    if (!ok || !fm) {
      violations.brokenFrontmatter.push({ slug, issues: ['frontmatter unparsable' + (err ? ': ' + err : '')] })
      continue
    }

    // (3) frontmatter לא-חוקי
    const issues = []
    for (const r of REQUIRED) {
      const v = fm[r]
      if (v === undefined || v === null || (typeof v === 'string' && v.trim() === '')) issues.push(`חסר שדה חובה: ${r}`)
    }
    const clusterTitle = typeof fm.cluster === 'string' ? fm.cluster : (fm.cluster != null ? String(fm.cluster) : '')
    if (clusterTitle && !VALID_CLUSTER_TITLES.has(clusterTitle)) issues.push(`cluster לא-חוקי: "${clusterTitle}"`)
    if (fm.readingMinutes !== undefined) {
      const rmOk = Number.isInteger(fm.readingMinutes) || /^\d+$/.test(String(fm.readingMinutes).trim())
      if (!rmOk) issues.push(`readingMinutes לא מספר שלם: "${fm.readingMinutes}"`)
    }
    if (issues.length) violations.brokenFrontmatter.push({ slug, issues })

    const c = CLUSTER_BY_TITLE[clusterTitle]
    const art = {
      slug,
      file: f,
      title: fm.title != null ? String(fm.title) : '',
      clusterTitle,
      clusterSlug: c ? c.slug : '',
      draft: truthy(fm.draft),
      needsReview: truthy(fm.needsReview),
      demo: truthy(fm.demo),
      pubDate: fm.pubDate != null ? String(fm.pubDate) : '',
      ageDays: ageDays(fm.pubDate),
      sources: Array.isArray(fm.sources) ? fm.sources : [],
      body,
    }
    arts.push(art)

    // (2) מתקלקל: draft/needsReview מבוגר מהסף
    if ((art.draft || art.needsReview) && art.ageDays != null && art.ageDays > ROT_DAYS) {
      violations.rotting.push({
        slug, ageDays: art.ageDays,
        flags: [art.draft && 'draft', art.needsReview && 'needsReview'].filter(Boolean),
      })
    }

    // (5) מקורות עם כותרת דף-שגיאה
    for (const s of art.sources) {
      const t = s && (s.title != null ? String(s.title) : '')
      if (t && ERROR_TITLE_RE.test(t)) {
        violations.errorSources.push({ slug, title: t.slice(0, 120), url: (s.url || s.uri || '').slice(0, 200) })
      }
    }

    // (4) קישורים פנימיים ל-slug/אשכול לא-קיים
    const linkRe = /\]\((\/magazine\/[^)\s]+)\)/g
    let lm
    const seen = new Set()
    while ((lm = linkRe.exec(body)) !== null) {
      let href = lm[1]
      if (seen.has(href)) continue
      seen.add(href)
      const path = href.replace(/[#?].*$/, '') // חתוך עוגן/query
      const clusterMatch = path.match(/^\/magazine\/cluster\/([^/]+)$/)
      if (clusterMatch) {
        if (!CLUSTER_SLUGS.has(decodeURIComponent(clusterMatch[1]))) violations.brokenInternalLinks.push({ slug, href, reason: 'cluster לא קיים' })
        continue
      }
      const artMatch = path.match(/^\/magazine\/([^/]+)$/)
      if (artMatch) {
        const target = decodeURIComponent(artMatch[1])
        if (target === slug) continue // קישור-עצמי בלתי-מזיק
        if (!slugSet.has(target) && !slugSet.has(artMatch[1])) violations.brokenInternalLinks.push({ slug, href, reason: 'slug יעד לא קיים' })
      }
      // כל מסלול /magazine/... אחר (עמוד אינדקס וכו') — לא נבדק
    }
  }

  // (1) כותרות כפולות / כמעט-כפולות
  const byNorm = new Map()
  for (const a of arts) {
    if (!a.title) continue
    const key = normTitle(a.title)
    if (!key) continue
    if (!byNorm.has(key)) byNorm.set(key, [])
    byNorm.get(key).push(a.slug)
  }
  for (const [key, slugs] of byNorm) {
    if (slugs.length > 1) violations.duplicateTitles.push({ normalized: key, slugs })
  }
  // כמעט-כפולות: זוגות עם דמיון גבוה שאינם כבר כפילות-מדויקת
  const titled = arts.filter((a) => a.title)
  for (let i = 0; i < titled.length; i++) {
    for (let j = i + 1; j < titled.length; j++) {
      if (normTitle(titled[i].title) === normTitle(titled[j].title)) continue // כבר נספר כ-duplicate
      const sim = tokenSim(titled[i].title, titled[j].title)
      if (sim >= NEAR_DUP_SIM) {
        violations.nearDuplicateTitles.push({ a: titled[i].slug, b: titled[j].slug, sim: Number(sim.toFixed(2)) })
      }
    }
  }

  // ── סיכום מצב-בנק ──
  const published = {}, drafts = {}
  for (const c of CLUSTERS) { published[c.slug] = 0; drafts[c.slug] = 0 }
  let publishedTotal = 0, draftsTotal = 0
  for (const a of arts) {
    const bucket = a.clusterSlug || 'unknown'
    if (a.draft) {
      draftsTotal++
      if (a.clusterSlug) drafts[a.clusterSlug]++
    } else {
      publishedTotal++
      if (a.clusterSlug) published[a.clusterSlug]++
    }
  }

  const counts = {
    duplicateTitles: violations.duplicateTitles.length,
    nearDuplicateTitles: violations.nearDuplicateTitles.length,
    rotting: violations.rotting.length,
    brokenFrontmatter: violations.brokenFrontmatter.length,
    brokenInternalLinks: violations.brokenInternalLinks.length,
    errorSources: violations.errorSources.length,
  }
  const totalViolations = Object.values(counts).reduce((s, n) => s + n, 0)

  const bank = {
    articles: arts.length,
    published: publishedTotal,
    drafts: draftsTotal,
    publishedByCluster: published,
    draftsByCluster: drafts,
  }

  result({ ok: true, totalViolations, counts, bank, violations })

  return { totalViolations, counts, bank, violations }
}

// ── ניסוח התראת-טלגרם תמציתית (רק כשיש הפרות) ──
function alertText({ counts, bank, violations }) {
  const L = ['🚨 <b>Scayla · ביקורת שלמות — נמצאו הפרות</b>']
  const line = (emoji, label, items) => { if (items && items.length) L.push(`${emoji} ${label}: <b>${items.length}</b>`) }
  line('🔁', 'כותרות כפולות', violations.duplicateTitles)
  line('🔂', 'כמעט-כפולות', violations.nearDuplicateTitles)
  line('🕰️', `מתקלקל (>${ROT_DAYS}ד')`, violations.rotting)
  line('🧩', 'frontmatter שבור', violations.brokenFrontmatter)
  line('🔗', 'קישורים שבורים', violations.brokenInternalLinks)
  line('⛔', 'מקורות-שגיאה', violations.errorSources)

  // דגימות קונקרטיות (עד 3 לכל קטגוריה) — כדי שאפשר לפעול בלי לפתוח את ה-JSON
  const samples = []
  for (const d of violations.duplicateTitles.slice(0, 3)) samples.push(`• כפול: ${d.slugs.join(' ⇄ ')}`)
  for (const d of violations.nearDuplicateTitles.slice(0, 3)) samples.push(`• דומה (${d.sim}): ${d.a} ⇄ ${d.b}`)
  for (const r of violations.rotting.slice(0, 3)) samples.push(`• רקוב ${r.ageDays}ד': ${r.slug}`)
  for (const b of violations.brokenFrontmatter.slice(0, 3)) samples.push(`• fm: ${b.slug} — ${(b.issues[0] || '').slice(0, 60)}`)
  for (const b of violations.brokenInternalLinks.slice(0, 3)) samples.push(`• לינק: ${b.slug} → ${b.href}`)
  for (const e of violations.errorSources.slice(0, 3)) samples.push(`• מקור-שגיאה: ${e.slug}`)
  if (samples.length) L.push('', ...samples.slice(0, 10))

  L.push('', `🏦 מאגר: ${bank.published} פורסמו · ${bank.drafts} טיוטות · ${bank.articles} סה"כ`)
  // בריחת-HTML בסיסית (parse_mode:HTML)
  return L.join('\n').replace(/&(?!amp;|lt;|gt;)/g, '&amp;')
}

try {
  const r = main()
  if (r.totalViolations > 0) {
    await notify(alertText(r))
    console.error(`⚠ integrity: ${r.totalViolations} violations`, r.counts)
  } else {
    console.error('✓ integrity clean — no violations (silence = health)')
  }
  process.exit(0) // הפרות אינן כשל-הרצה · הן ממצא. יציאה 0.
} catch (e) {
  result({ ok: false, fatal: String(e.message || e).slice(0, 200) })
  console.error('FATAL:', e)
  process.exit(1)
}
