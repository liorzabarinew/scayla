#!/usr/bin/env node
// ─────────────────────────────────────────────────────────────────────────────
// fixer.mjs · Scayla — מכונת-התיקונים העצמאית.
//
// עיקרון (לפי בקשת ליאור): שכבת ה-QA היא **ניטור בלבד** ואינה חוסמת. מכונת-התיקונים
// לוקחת מאמר, מריצה QA (monitor) → מתקנת (fix) → חוזרת ל-QA לוודא שהתיקון עמד בדרישות
// (re-verify) → וחוזרת חלילה עד שנקי או עד MAX_FIX_ROUNDS. הסבב האחרון אגרסיבי (מסיר כל
// מספר/טענה שלא ניתן לאמת). התוצאה **תמיד ראויה לפרסום** — שום מאמר לא נשאר "טיוטה על איכות".
//
// שימוש עיקרי: לשגר מאמרים שנתקעו כ-needsReview (מהמנגנון הישן), ולתקן-ולשגר מאמרים קיימים.
// אותו "מוח" של המכונה (ייבוא מ-machine-vertex.mjs) → תיקון זהה לזרימת-הכתיבה.
//
// env: GOOGLE_SA, GCP_PROJECT · MAX_FIX_ROUNDS(=3) · TELEGRAM_* (סיכום, no-op בלי)
// הרצה: node scripts/fixer.mjs                 → כל המאמרים עם needsReview:true
//        node scripts/fixer.mjs <slug> [<slug>]→ מאמר(ים) מסוימים (עם/בלי .md)
// ─────────────────────────────────────────────────────────────────────────────
import { readFileSync, writeFileSync, readdirSync } from 'fs'
import { join } from 'path'
import { normalizeBrands } from './brand-glossary.mjs'
import {
  callGemini, fixPrompt, parseArticle,
  qa, qaCopyEdit, qaGeminiClaims, qaCrossModel, qaSourceGrounding,
  fetchSourceTexts, injectSources, validateLinks, fixFmQuotes, appendCta,
  setDraft, ARTICLES_DIR, MAX_FIX_ROUNDS,
  tidyMarkdown, lintArticle, stampReadingMinutes, sanitizeSlug,
  fixModelForRound, fixRegionForRound, hasHardIssue, HARD_ISSUE_RE,
} from './machine-vertex.mjs'
import { notify } from './notify.mjs'

const today = new Date().toISOString().slice(0, 10)
const files = readdirSync(ARTICLES_DIR).filter((f) => f.endsWith('.md'))
const validSlugs = new Set(files.map((f) => f.replace(/\.md$/, '')))
const result = (o) => console.log('RESULT:' + JSON.stringify(o))

// מקורות מה-frontmatter של המאמר → [{title,url}] (לאימות-מספרים)
function fmSources(md) {
  const fm = (md.match(/^---\n([\s\S]*?)\n---/) || [])[1] || ''
  const sm = fm.match(/^sources:\n([\s\S]*?)(?=^\S|\Z)/m)
  if (!sm) return []
  const re = /- title:\s*["']?(.+?)["']?\s*\n\s*url:\s*["']?(.+?)["']?\s*$/gm
  const out = []; let m
  while ((m = re.exec(sm[1]))) out.push({ title: m[1], url: m[2] })
  return out
}
// בונה מחדש את שרשרת ה-assemble של המכונה (ניקוי-קישורים, מותגים, CTA)
const assembleWith = (sources) => (m) =>
  appendCta(normalizeBrands(fixFmQuotes(validateLinks(injectSources(tidyMarkdown(m), sources), validSlugs))).md)

// bump updatedDate בלבד · pubDate לעולם לא משתנה
function bumpUpdated(md) {
  if (/^updatedDate:/m.test(md)) return md.replace(/^updatedDate:.*$/m, `updatedDate: ${today}`)
  if (/^pubDate:/m.test(md)) return md.replace(/^(pubDate:.*)$/m, `$1\nupdatedDate: ${today}`)
  return md
}

// monitor → fix-loop → re-verify · מחזיר מאמר מוכן-לפרסום
async function refine(md0, slug0) {
  let md = md0, slug = slug0
  const sources = fmSources(md)
  const srcTexts = await fetchSourceTexts(sources).catch(() => [])
  const assemble = assembleWith(sources)

  // ── MONITOR (QA · detect only) ──
  let issues = [...lintArticle(md).issues]
  const [v, cp, gc, c, sg] = await Promise.all([
    qa(slug, md).catch(() => null),
    qaCopyEdit(md).catch(() => null),
    qaGeminiClaims(slug, md).catch(() => null),
    qaCrossModel(slug, md).catch(() => null),
    qaSourceGrounding(md, srcTexts).catch(() => null),
  ])
  // QA-infrastructure guard · findings never block, but QA being DOWN must. If every lens
  // failed to run (auth/outage), do NOT ship unverified — that would be fail-open.
  if (!v && !cp && !gc && !c && !sg) throw new Error('QA unavailable (all lenses failed) — not shipping unverified')
  const claimsOf = (o) => (o && !o._parseFailed)
    ? [...(o.issues || []), ...((o.claims || []).filter((x) => x.verifiedBySearch === 'no').map((x) => `הסר או רכך טענה לא-מאומתת: ${x.claim}`))]
    : []
  if (v && (v.verdict === 'reject' || v.verdict === 'fixable' || v.fabricated)) issues.push(...(v.issues || []))
  issues.push(...claimsOf(c), ...claimsOf(gc))
  if (cp && !cp._parseFailed && cp.hasIssues) issues.push(...(cp.issues || []).map((i) => `לשון: ${i}`))
  if (sg && !sg._skipped && Array.isArray(sg.unsupported) && sg.unsupported.length) {
    issues.push(...sg.unsupported.slice(0, 8).map((u) => `מספר לא-נתמך-במקור: "${(u.claim || '').slice(0, 90)}" — החלף במספר מהמקור או רכך בלי מספר.`))
  } else if (sg && sg._skipped) {
    const body = md.replace(/^---[\s\S]*?\n---\n?/, '')
    if (/\d+(?:[.,]\d+)?\s*%|\bפי\s+\d|\d{1,3}(?:,\d{3})+/.test(body)) issues.push('לא ניתן לאמת מספרים מול מקור · ודא שכל מספר מגובה, אחרת רכך בלי מספר.')
  }
  issues = [...new Set(issues.filter(Boolean))]

  // ── FIX → RE-VERIFY loop · המודל מטפס בכל סבב (סבב 1 = Flash · סבב 2+ = Pro) ──
  let round = 0, note = issues.length ? 'fixing' : 'clean'
  while (issues.length && round < MAX_FIX_ROUNDS) {
    round++
    const aggressive = round >= MAX_FIX_ROUNDS
    const fixModel = fixModelForRound(round), fixRegion = fixRegionForRound(round)
    console.error(`  fix round ${round}/${MAX_FIX_ROUNDS}${aggressive ? ' [aggressive]' : ''} · [${fixModel}] · ${issues.length} issue(s)`)
    const fx = parseArticle((await callGemini(fixPrompt(`SLUG: ${slug}\n\n${md}`, issues, { aggressive }), { maxTokens: 16000, temperature: 0.3, model: fixModel, region: fixRegion })).text)
    if (fx.slug && fx.md.startsWith('---')) { slug = fx.slug; md = assemble(fx.md) }
    else { console.error('  ⚠ fixer output unparseable — ending loop'); break }
    const rl = lintArticle(md)
    const [rq, rsg] = await Promise.all([
      qaCrossModel(slug, md).catch(() => null),
      qaSourceGrounding(md, srcTexts).catch(() => null),
    ])
    issues = []
    if (rl.titleBad) issues.push('כותרת לא תקינה (אורך/מבנה)')
    if (rl.truncated) issues.push('התוכן קטוע · השלם')
    if (rl.broken) issues.push('מבנה שבור · תקן')
    if (rl.factWrong) issues.push(...(rl.issues || []).filter((i) => i.includes('ייחוס')))
    if (rq && !rq._parseFailed) issues.push(...((rq.claims || []).filter((x) => x.verifiedBySearch === 'no').map((x) => `הסר או רכך טענה: ${x.claim}`)))
    if (rsg && !rsg._skipped && Array.isArray(rsg.unsupported) && rsg.unsupported.length) issues.push(...rsg.unsupported.slice(0, 8).map((u) => `מספר לא-נתמך: "${(u.claim || '').slice(0, 80)}"`))
    issues = [...new Set(issues.filter(Boolean))]
    note = issues.length ? `fixing-r${round}` : `clean-r${round}`
  }

  // ── SHIP or SHELVE · נותרה בעיה קשה (מבנה/ייחוס) אחרי כל הסבבים המסלימים → גניזה: draft:true
  //    (מוסתר מהאתר) + יציאה מתור-הביקורת (לא מעובד לנצח). אחרת → שיגור: draft:false. ──
  const shelved = hasHardIssue(issues)
  md = md.replace(/^needsReview:.*\n?/m, '') // יוצא מהתור בכל מקרה — שוגר או נגנז-סופית
  md = setDraft(md, shelved)
  md = bumpUpdated(md)
  md = stampReadingMinutes(md)
  return { md, slug: sanitizeSlug(slug), note, residual: issues.slice(0, 6), rounds: round, shelved }
}

async function main() {
  const args = process.argv.slice(2).filter((a) => !a.startsWith('-')).map((a) => a.replace(/\.md$/, ''))
  let targets
  if (args.length) {
    targets = args.map((s) => `${s}.md`).filter((f) => files.includes(f))
    if (!targets.length) { result({ status: 'error', reason: 'no matching articles for: ' + args.join(', ') }); process.exit(1) }
  } else {
    // ברירת מחדל: כל מה שנתקע כ-needsReview
    targets = files.filter((f) => /^needsReview:\s*true/m.test(readFileSync(join(ARTICLES_DIR, f), 'utf8')))
  }
  if (!targets.length) { console.error('אין מאמרים לתיקון (0 needsReview).'); result({ status: 'ok', fixed: 0, articles: [] }); return }

  console.error(`🛠  fixer · ${targets.length} מאמר(ים) לעיבוד`)
  const done = []
  for (const f of targets) {
    const path = join(ARTICLES_DIR, f)
    const slug = f.replace(/\.md$/, '')
    console.error(`\n──── ${slug} ────`)
    try {
      const r = await refine(readFileSync(path, 'utf8'), slug)
      const outPath = join(ARTICLES_DIR, `${r.slug}.md`)
      writeFileSync(outPath, r.md.endsWith('\n') ? r.md : r.md + '\n')
      console.error(`${r.shelved ? '⛔ נגנז' : '✓ שוגר'} ${r.slug} (${r.rounds} סבב, ${r.note}${r.residual.length ? `, ${r.residual.length} שרידי` : ''})`)
      done.push({ slug: r.slug, rounds: r.rounds, note: r.note, residual: r.residual.length, shelved: r.shelved })
    } catch (e) {
      console.error(`✗ ${slug}: ${String(e).slice(0, 160)}`)
      done.push({ slug, error: String(e).slice(0, 160) })
    }
  }

  const shipped = done.filter((d) => !d.error && !d.shelved).length
  const shelved = done.filter((d) => d.shelved).length
  const withResidual = done.filter((d) => !d.shelved && d.residual > 0).length
  await notify(`🛠 <b>מכונת-התיקונים</b>\n${shipped}/${done.length} שוגרו לאוויר${shelved ? ` · ⛔ ${shelved} נגנזו (לא עברו QA אחרי ${MAX_FIX_ROUNDS} סבבים)` : ''}${withResidual ? ` · ${withResidual} עם שרידים` : ''}\n${done.map((d) => d.error ? `✗ ${d.slug}` : d.shelved ? `⛔ ${d.slug} (נגנז · ${d.rounds} סבב)` : `✓ ${d.slug} (${d.rounds} סבב)`).join('\n')}`)
  result({ status: 'ok', fixed: shipped, shelved, articles: done })
}

main().catch((e) => { console.error('fixer fatal:', String(e && e.stack ? e.stack : e).slice(0, 300)); result({ status: 'error', reason: String(e).slice(0, 200) }); process.exit(1) })
