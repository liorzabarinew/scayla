#!/usr/bin/env node
// postbuild-sitemap-lastmod.mjs · מזריק <lastmod> לכתובות המאמרים ב-sitemap אחרי הבנייה.
// האינטגרציה של @astrojs/sitemap לא רואה frontmatter, אז כל הכתובות יוצאות בלי lastmod
// למרות שלכל מאמר יש updatedDate/pubDate · גוגל מאבד את אות הרעננות. רץ כ-postbuild,
// אידמפוטנטי (בלוק שכבר קיבל lastmod לא נתפס שוב בתבנית).
// ארגומנט אופציונלי: תיקיית dist חלופית · לבדיקות מקומיות בלי בנייה.
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, basename } from 'path'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')
const DIST = process.argv[2] || join(ROOT, 'dist')
const ARTICLES_DIR = join(ROOT, 'src/content/magazine')

// ── מפת slug → תאריך · updatedDate עדיף, אחרת pubDate ──
// המפתח הוא שם הקובץ ב-lowercase · Astro מנרמל את ה-route ל-slug באותיות קטנות
// (אותה אבחנה כמו ב-gen-llms.mjs), אז "AI" בשם הקובץ הופך ל-ai בכתובת.
function buildDateMap() {
  const map = new Map()
  if (!existsSync(ARTICLES_DIR)) return map
  for (const f of readdirSync(ARTICLES_DIR)) {
    if (!f.endsWith('.md')) continue
    const raw = readFileSync(join(ARTICLES_DIR, f), 'utf8')
    const fm = (raw.match(/^---\n([\s\S]*?)\n---/) || [])[1] || ''
    const g = (k) => (fm.match(new RegExp(`^${k}:\\s*["']?(.+?)["']?\\s*$`, 'm')) || [])[1] || ''
    const d = new Date(g('updatedDate') || g('pubDate'))
    if (isNaN(d)) continue // בלי תאריך תקין אין מה להזריק · עדיף לדלג מאשר לזייף
    map.set(f.replace(/\.md$/, '').toLowerCase(), d.toISOString().slice(0, 10))
  }
  return map
}

const dates = buildDateMap()

// כתובת מאמר בלבד: /magazine/<slug> · לא /magazine עצמו ולא /magazine/cluster/*.
// ה-slug ב-sitemap מקודד באחוזים (עברית), אז decodeURIComponent לפני ההתאמה.
function lastmodFor(loc) {
  let path
  try {
    path = decodeURIComponent(new URL(loc).pathname)
  } catch {
    return null
  }
  const m = path.match(/^\/magazine\/([^/]+)$/)
  if (!m) return null
  return dates.get(m[1].toLowerCase()) || null
}

const files = existsSync(DIST)
  ? readdirSync(DIST).filter((f) => /^sitemap-\d+\.xml$/.test(f))
  : []
if (!files.length) {
  console.error(`✗ postbuild-sitemap-lastmod · לא נמצא sitemap-N.xml ב-${DIST}`)
  process.exit(1)
}

for (const f of files) {
  const p = join(DIST, f)
  const xml = readFileSync(p, 'utf8')
  let injected = 0
  const out = xml.replace(/<url><loc>([^<]+)<\/loc><\/url>/g, (whole, loc) => {
    const d = lastmodFor(loc)
    if (!d) return whole
    injected++
    return `<url><loc>${loc}</loc><lastmod>${d}</lastmod></url>`
  })
  writeFileSync(p, out)
  console.log(`✓ ${basename(p)} · הוזרק lastmod ל-${injected} כתובות מאמרים`)
}

// ── /sitemap.xml · מפת האתר הקנונית שמגישים ל-Search Console ──
// @astrojs/sitemap פולט sitemap-index.xml + sitemap-N.xml, ואין /sitemap.xml
// (הכתובת שבני-אדם וכלים מצפים לה · החזירה 404). האתר מתחת ל-50,000 כתובות,
// אז מפה שטוחה אחת חוקית לגמרי ופשוטה יותר להגשה ולניפוי-שגיאות.
// נכתב אחרי הזרקת ה-lastmod כדי שהעותק יכיל אותו. אם אי-פעם יהיו כמה
// sitemap-N, נאחד את כולם לקובץ אחד במקום להעתיק את הראשון.
{
  const urls = files
    .map((f) => readFileSync(join(DIST, f), 'utf8'))
    .flatMap((xml) => xml.match(/<url>[\s\S]*?<\/url>/g) || [])
  const head =
    '<?xml version="1.0" encoding="UTF-8"?>\n' +
    '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n'
  writeFileSync(join(DIST, 'sitemap.xml'), head + urls.join('\n') + '\n</urlset>\n')
  console.log(`✓ sitemap.xml · מפה שטוחה אחת · ${urls.length} כתובות`)
}
