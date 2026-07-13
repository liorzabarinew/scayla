// guards.test.mjs · בדיקות-יחידה ל-fail-closed guards של מכונת התוכן.
// הקוד שמחליט אם לפרסם חייב להיות בדוק. הרצה: node --test scripts/
import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
  schemaViolations, tidyMarkdown, sanitizeSlug, stampReadingMinutes, mostSimilarArticle, lintArticle,
  fixModelForRound, fixRegionForRound, hasHardIssue,
} from './machine-vertex.mjs'

// frontmatter תקין לבנייה מהירה של fixtures
const fm = (over = {}) => {
  const d = { title: 'מדריך SEO ו-GEO לשופיפיי', description: 'תיאור מספיק ארוך של המאמר לצורך בדיקת אורך תקין של השדה במטא, מעל מאה ועשרה תווים בערך כאן.', pubDate: '2026-07-10', cluster: 'SEO לחנויות שופיפיי', readingMinutes: '6', ...over }
  return `---\ntitle: "${d.title}"\ndescription: "${d.description}"\npubDate: ${d.pubDate}\ncluster: "${d.cluster}"\nreadingMinutes: ${d.readingMinutes}\ndemo: false\ndraft: false\nsources:\n  - title: "Google Search Central"\n    url: "https://developers.google.com/search"\n---\n`
}
const bodyOk = '**זו פסקת פתיחה מודגשת שעונה ישירות על שאלת המאמר בכ-40 מילים, מספקת הקשר ברור לקורא, ומסבירה מה יילמד בהמשך בצורה עניינית ומדויקת לגמרי.**\n\n' + 'תוכן אמיתי. '.repeat(400) + '\n\n## מה חשוב לזכור\n- נקודה אחת.\n- נקודה שתיים.\n- נקודה שלוש.\n'

test('schemaViolations: valid frontmatter passes', () => {
  assert.deepEqual(schemaViolations(fm() + bodyOk), [])
})
test('schemaViolations: invalid cluster is caught', () => {
  const v = schemaViolations(fm({ cluster: 'קטגוריה לא קיימת' }) + bodyOk)
  assert.ok(v.some((x) => x.includes('cluster')), 'should flag bad cluster')
})
test('schemaViolations: non-integer readingMinutes is caught', () => {
  const v = schemaViolations(fm({ readingMinutes: '<מספר>' }) + bodyOk)
  assert.ok(v.some((x) => x.includes('readingMinutes')))
})

test('tidyMarkdown: em-dash becomes comma, not middot', () => {
  const out = tidyMarkdown('שלום — עולם')
  assert.ok(out.includes(','), 'em-dash → comma')
  assert.ok(!out.includes('—'), 'no em-dash remains')
})
test('tidyMarkdown: malformed internal link is repaired', () => {
  const out = tidyMarkdown('ראו [כאן](https-scayla-co-il/magazine/foo-bar)')
  assert.ok(out.includes('](/magazine/foo-bar)'), 'malformed link → root-relative')
})
test('tidyMarkdown: numeric range dash preserved as hyphen', () => {
  assert.ok(tidyMarkdown('5–7 ימים').startsWith('5-7'))
})

test('sanitizeSlug: keeps Hebrew, collapses separators, strips quotes', () => {
  assert.equal(sanitizeSlug('  "מדריך  seo"  '), 'מדריך-seo')
})

test('stampReadingMinutes: computed from word count', () => {
  const md = fm() + '\n' + 'מילה '.repeat(600)
  const out = stampReadingMinutes(md)
  assert.match(out, /readingMinutes: 3/) // 600 words / 200 = 3
})

test('lintArticle: clean article has no hard failures', () => {
  const l = lintArticle(fm() + bodyOk)
  assert.equal(l.factWrong, false, 'no fabricated attribution')
  assert.equal(l.truncated, false, 'not truncated')
  assert.equal(l.broken, false, 'not broken')
})
test('lintArticle: attribution to a body NOT in sources is flagged (the #1 defect)', () => {
  const bad = fm() + '**פתיח מודגש ארוך שעונה על השאלה בכ-40 מילים לפחות, נותן הקשר, ומסביר את מה שנלמד בהמשך המאמר בצורה בהירה מאוד לקוראים.**\n\n' + 'לפי Akamai, עיכוב של שנייה מוריד המרות ב-7%. ' + 'תוכן. '.repeat(400) + '\n\n## מה חשוב לזכור\n- א.\n- ב.\n'
  const l = lintArticle(bad)
  assert.equal(l.factWrong, true, 'Akamai not in sources → factWrong')
  assert.ok(l.issues.some((i) => i.includes('ייחוס') && i.includes('Akamai')))
})
test('lintArticle: truncation (unclosed bold) is caught', () => {
  const trunc = fm() + bodyOk.replace(/## מה חשוב לזכור[\s\S]*$/, '') + '\nוכאן המשפט נחתך **באמצע מודגש'
  const l = lintArticle(trunc)
  assert.equal(l.truncated, true)
})
test('lintArticle: thin body is caught', () => {
  const thin = fm() + '**פתיח.**\n\nקצר מדי.\n\n## מה חשוב לזכור\n- א.\n'
  assert.equal(lintArticle(thin).truncated, true) // thin folds into truncated
})

test('mostSimilarArticle: near-duplicate title ≥0.8 is detected', () => {
  const arts = [{ title: 'מחקר מילות מפתח לאיקומרס מדריך', slug: 'keyword-research-ecommerce' }]
  const hit = mostSimilarArticle('מחקר מילות מפתח לאיקומרס', 'keyword-research', arts)
  assert.ok(hit, 'should detect the near-duplicate')
})
test('mostSimilarArticle: unrelated title returns null', () => {
  const arts = [{ title: 'מהירות אתר Core Web Vitals', slug: 'core-web-vitals' }]
  assert.equal(mostSimilarArticle('בניית קישורים פנימיים', 'internal-links', arts), null)
})

// ── QA fix-ladder (בקשת ליאור): מודל מסלים פר-סבב + גניזה רק על בעיה קשה ──
test('fixModelForRound: round 1 is Flash (cheap/fast), round 2+ is Pro (strong)', () => {
  assert.match(fixModelForRound(1), /flash/)
  assert.match(fixModelForRound(2), /pro/)
  assert.match(fixModelForRound(3), /pro/)
  assert.match(fixModelForRound(9), /pro/) // מעבר לאורך הסולם → נשאר על החזק
  assert.match(fixModelForRound(0), /flash/) // הגנה: round<1 מתקבע ל-1
})
test('fixRegionForRound: Flash→global, Pro→us-central1 (endpoint per model)', () => {
  assert.equal(fixRegionForRound(1), 'global')
  assert.equal(fixRegionForRound(2), 'us-central1')
})
test('hasHardIssue: structural/attribution issues shelve; soft claims/numbers do not', () => {
  assert.equal(hasHardIssue(['מבנה שבור · תקן']), true)
  assert.equal(hasHardIssue(['כותרת לא תקינה (אורך/מבנה)']), true)
  assert.equal(hasHardIssue(['התוכן קטוע · השלם']), true)
  assert.equal(hasHardIssue(['ייחוס שגוי של מקור']), true)
  assert.equal(hasHardIssue(['הסר או רכך טענה לא-מאומתת: x']), false) // מוסר בסבב האגרסיבי
  assert.equal(hasHardIssue(['מספר לא-נתמך-במקור: "y"']), false)      // מוסר בסבב האגרסיבי
  assert.equal(hasHardIssue([]), false)
})
