/**
 * צינור המאמרים של /scan · שני מאמרים לחנות של הליד.
 *
 * לוקח את הלוגיקה של machine-vertex.mjs (עדשות QA מקבילות, סולם תיקון מסלים,
 * שערים דטרמיניסטיים) אבל עומד בפני עצמו · לא מייבא, לא כותב ל-src/content
 * ולא נוגע בבנק התוכן. מאמר של ליד לא נכנס למגזין של Scayla לעולם.
 *
 * שני המאמרים רצים במקביל · המשך הוא הזמן של האיטי מביניהם, לא הסכום.
 */
import { callGemini } from './machine.mjs';

const MAX_FIX_ROUNDS = 4;
// pro בכל הסבבים · הכתיבה היא ה"וואו" שהלקוח רואה, לא המקום לחסוך
const FIX_MODELS = ['gemini-2.5-pro', 'gemini-2.5-pro', 'gemini-2.5-pro'];
const fixModelForRound = (r) => FIX_MODELS[Math.min(Math.max(1, r | 0) - 1, FIX_MODELS.length - 1)];

// מה באמת חוסם שחרור · אחרי סבבי התיקון. סגנון לא חוסם, אבל שלד כן:
// מאמר של 2,172 תווים שוחרר ללקוח כי הרשימה הקודמת לא הכירה "רדוד".
// כולל 'חסר' · מאמר בלי טבלה/תשובה-ישירה/מה-חשוב-לזכור לא ישוחרר כנקי.
// אם אחרי כל הסבבים עדיין חסר · הכרטיס יסומן "סימנו דברים לשיפור" במקום
// להתחזות למאמר GEO מלא.
const HARD_ISSUE_RE = /כותרת לא תקינה|קטוע|מבנה שבור|ייחוס|רדוד|מומצא|לא נתמכת|לא מבוסס|חסר/;
const hasHardIssue = (issues) => (issues || []).some((i) => HARD_ISSUE_RE.test(String(i)));

/** בוחר שני נושאים מהפערים שנמדדו · לא מהאוויר. */
export async function pickTopics(store, score) {
  const missed = score.answers.filter((a) => !a.mentioned).map((a) => a.q);
  const pool = missed.length >= 2 ? missed : score.answers.map((a) => a.q);
  const prompt = `אתה מתכנן תוכן לחנות אונליין ישראלית.

החנות: ${store.title || store.host} (${store.host})
מה היא מוכרת: ${(store.description || store.text || '').slice(0, 700)}

אלה שאלות קונה אמיתיות שבהן החנות לא הופיעה בתשובת ה-AI:
${pool.slice(0, 6).map((q, i) => `${i + 1}. ${q}`).join('\n')}

בחר בדיוק 2 נושאי מאמר שונים זה מזה, שכתיבתם תעזור לחנות להופיע בשאלות כאלה.
כללים:
- כל נושא חייב להיות מבוסס על שאלה מהרשימה, לא על רעיון חדש.
- שני נושאים מזוויות שונות · לא שתי גרסאות של אותו דבר.
- כותרת בעברית, מדויקת, בלי סופרלטיבים ובלי הבטחות תוצאה.
החזר JSON:
[{"title":"<כותרת המאמר>","angle":"<במשפט: על מה הוא עונה>","query":"<השאלה מהרשימה>"}]`;

  const { text } = await callGemini(prompt, { json: true, maxTokens: 4000 });
  const raw = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let arr;
  try { arr = JSON.parse(raw); } catch { arr = JSON.parse((raw.match(/\[[\s\S]*\]/) || ['[]'])[0]); }
  const out = (Array.isArray(arr) ? arr : []).filter((x) => x?.title).slice(0, 2);
  if (out.length < 2) throw new Error('topics: need 2');
  return out;
}

/** מחקר מעוגן · מקורות אמיתיים, לא זיכרון של המודל. */
async function research(topic, store) {
  const { text, sources } = await callGemini(
    `אסוף עובדות ומקורות עדכניים לכתיבת מאמר בעברית בנושא: "${topic.title}".
הקשר: חנות אונליין ישראלית בתחום ${store.title || store.host}.
החזר סיכום עובדתי תמציתי · רק מה שנתמך במקורות שמצאת. ציין מספרים רק אם הם מופיעים במקור.`,
    { grounded: true, maxTokens: 8000, timeoutMs: 120_000 },
  );
  return { brief: text, sources };
}

async function write(topic, store, brief) {
  // הפורמט זהה למכונת התוכן הפנימית (machine-vertex.mjs · writePrompt):
  // תשובה ישירה מודגשת ל-GEO, כותרות-שאלה, טבלת השוואה, takeaways ("בקצרה
  // ל-AI"), FAQ והגדרת מושג. זה מה שגורם ל-AI לצטט אותנו · בלי אלה המאמר "רגיל".
  const { text } = await callGemini(
    `אתה כותב מאמר בעברית לבלוג של חנות אונליין ישראלית: ${store.title || store.host}.
קול של איש-מקצוע שמדבר עם קונה · חם, פרקטי, בוטח, בלי יומרה אקדמית ובלי באזזוורדס.

נושא: ${topic.title}
הזווית: ${topic.angle}
השאלה שהמאמר עונה עליה: ${topic.query}

עובדות מהמחקר · אל תוסיף עובדה, מספר או אחוז שלא מופיעים כאן:
${brief.slice(0, 3500)}

כתוב מאמר מנצח ל-SEO ול-GEO. אורך 1100-1500 מילים.

המבנה (קריטי לציטוט ב-AI · לא הצעה, דרישה):
1. **תשובה ישירה מודגשת של 40-60 מילים** בפתיחה (**טקסט**), שעונה מיד על השאלה ועומדת בפני עצמה. המשפט הראשון פותח בשם-הנושא המלא.
2. 6 עד 8 כותרות ## · תחת כל אחת 150-250 מילים. לפחות 2-3 כותרות בצורת שאלה ("איך...?", "כמה...?", "מתי...?"). הפסקה אחרי כותרת-שאלה עונה ישירות ב-1-2 משפטים ואז מרחיבה.
3. **טבלת השוואה אחת ב-Markdown** (מספר עמודות עקבי) · השוואה שעוזרת לקונה להחליט. חובה.
4. **הגדרה ברורה של מושג-מפתח אחד** בתחום · משפט אחד שה-AI יכול לצטט.
5. סעיף "## מה חשוב לזכור" עם 3-4 נקודות תמצית.

כל סעיף מוסיף ידע חדש · הסבר, דוגמה קונקרטית או קריטריון להחלטה. לא חזרה בניסוח אחר.

כללים קשיחים:
- כל טענה עובדתית נגזרת מהמחקר. אין "כבר שנים רבות" או "בחירה קפדנית" בלי ביסוס.
- שלב מספר/אחוז רק אם הוא מופיע במחקר, עם שם-המקור באותו משפט. אם המחקר דל · כתוב "לרוב"/"מחקרים מצביעים" במקום להמציא.
- עברית מקורית. אסור לתרגם מבנים מאנגלית ("משלבים בין X לבין Y", "מגיעים בגודל של").
- בלי הבטחות תוצאה, בלי מקפים ארוכים (המפריד הוא ·), בלי למכור את החנות בכל פסקה.
- עברית אנושית · בלי "בואו נצלול" ובלי "בשורה התחתונה".

פורמט הפלט · בדיוק כך, בלי טקסט מסביב:
ראשית גוף המאמר ב-Markdown נקי (בלי frontmatter, בלי כותרת H1).
ואז שורת מפריד בדיוק: ===META===
ואז JSON אחד תקין:
{"why":"<פסקה קצרה, 2-3 משפטים, שמסבירה לבעל החנות למה כתבנו לו דווקא את המאמר הזה: איזו שאלת קונה אמיתית הוא מכסה, ולמה חשוב שהחנות תופיע בתשובה עליה. כתוב מדליק ומזמין קריאה, לא גנרי. בלי הבטחות תוצאה>","takeaways":["<תובנה 1 · משפט מלא>","<תובנה 2>","<תובנה 3>"],"faq":[{"q":"<שאלה>","a":"<תשובה 1-2 משפטים>"},{"q":"<שאלה>","a":"<תשובה>"},{"q":"<שאלה>","a":"<תשובה>"}]}`,
    { maxTokens: 16000, timeoutMs: 180_000 },
  );

  // מפרידים את הגוף מה-why/takeaways/faq
  const idx = text.indexOf('===META===');
  if (idx === -1) return { md: stripPreamble(text), why: '', takeaways: [], faq: [] };
  const md = stripPreamble(text.slice(0, idx));
  let meta = { why: '', takeaways: [], faq: [] };
  try {
    const raw = text.slice(idx + 10).trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
    const j = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] || '{}');
    meta = {
      why: typeof j.why === 'string' ? j.why : '',
      takeaways: Array.isArray(j.takeaways) ? j.takeaways : [],
      faq: Array.isArray(j.faq) ? j.faq : [],
    };
  } catch { /* META לא תקין · הגוף עדיין תקף, ממשיכים בלי meta */ }
  return { md, ...meta };
}

// ── שערים דטרמיניסטיים · חינם, מיידיים, והקוד מחליט ──
export function lint(md) {
  const out = [];
  const words = (md || '').split(/\s+/).filter(Boolean).length;
  const heads = (md.match(/^## /gm) || []).length;

  // ── עומק · השער שנכשל. הסף הקודם היה 900 תווים, ומאמר של 2,172 תווים
  //    (6 סעיפים × ~360 תווים = שלד) עבר אותו בקלות ושוחרר ללקוח.
  if (words < 900) out.push(`קטוע · ${words} מילים בלבד, נדרשות לפחות 900`);
  if (heads < 5) out.push(`מבנה שבור · ${heads} כותרות, נדרשות לפחות 5`);

  // כל סעיף חייב עומק אמיתי · סעיף של פסקה אחת הוא שלד
  if (heads) {
    const secs = md.split(/^## /m).slice(1);
    const thin = secs.filter((s) => s.split(/\s+/).filter(Boolean).length < 90);
    if (thin.length) out.push(`קטוע · ${thin.length} סעיפים רדודים מדי (פחות מ-90 מילים)`);
  }

  // פורמט GEO של מכונת התוכן · טבלה, תשובה ישירה מודגשת, "מה חשוב לזכור"
  if (!/^\s*\|.*\|.*\n\s*\|[\s:|-]+\|/m.test(md)) out.push('חסר · אין טבלת השוואה במאמר');
  if (!/^\s*\*\*[\s\S]{40,}?\*\*/m.test(md.split('\n').slice(0, 6).join('\n'))) out.push('חסר · אין תשובה ישירה מודגשת בפתיחה');
  if (!/##\s*מה חשוב לזכור/.test(md)) out.push('חסר · אין סעיף "מה חשוב לזכור"');

  if (/—/.test(md)) out.push('מקף ארוך · אסור');
  if (/(דירוג ראשון|מובטח|תוך \d+ ימים|תוצאות מיידיות)/.test(md)) out.push('הבטחת תוצאה · אסור');
  if (/```(?![\s\S]*?```)/.test(md)) out.push('מבנה שבור · גדר קוד לא נסגרה');
  if (/\bסוכן\b/.test(md)) out.push('מילה אסורה · סוכן');
  return out;
}

const jsonLens = async (prompt, model) => {
  const { text } = await callGemini(prompt, { json: true, maxTokens: 5000, model });
  const raw = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  try { return JSON.parse(raw); } catch { return JSON.parse((raw.match(/\{[\s\S]*\}/) || ['{}'])[0]); }
};

/** חמש עדשות במקביל · כל אחת מסתכלת מזווית אחרת. */
async function qaAll(md, brief) {
  const lensWith = (name, body, model) =>
    jsonLens(`${body}\n\nהחזר JSON: {"issues":["<בעיה>"]}\n\nהמאמר:\n${md.slice(0, 14000)}`, model)
      .then((j) => ({ name, issues: j.issues || [] }))
      .catch(() => null);
  const lens = (name, body) => lensWith(name, body, undefined);

  const res = await Promise.all([
    // flash כאן בכוונה · מודל שונה מהכותב מקטין blind-spots מתואמים.
    // זו שונות, לא חיסכון. אותה כוונה כמו qaCrossModel במכונת התוכן.
    lensWith('facts', 'אתה עורך-בקרה. אתר טענות, מספרים או ציטוטים שנראים מומצאים או לא נתמכים. אל תפסול על סגנון.', 'gemini-2.5-flash'),
    lens('copy', 'אתה עורך לשון עברית. אתר עברית תרגומית, מקפים ארוכים, ניסוח מנופח או ביטויי AI שחוקים.'),
    lens('promise', 'אתה בודק ציות. אתר כל הבטחת תוצאה, סופרלטיב שיווקי או מכירה אגרסיבית של החנות.'),
    lens('struct', 'אתה בודק מבנה. אתר פסקאות קטועות, כותרות ריקות, חזרתיות בין סעיפים או פתיח שלא עונה על השאלה.'),
    lens('ground', `אתה בודק עיגון. אלה העובדות שאושרו במחקר:\n${brief.slice(0, 2000)}\n\nאתר כל טענה במאמר שלא נגזרת מהן.`),
  ]);

  // כל העדשות נפלו · לא משחררים מאמר שעבר אפס בקרה בזמן שהעמוד מבטיח בקרה מלאה
  if (res.every((r) => r === null)) throw new Error('QA unavailable · not shipping unverified');
  return res.filter(Boolean).flatMap((r) => r.issues).filter(Boolean);
}

async function fix(md, issues, round) {
  const { text } = await callGemini(
    `תקן את המאמר לפי הבעיות. תקן נקודתית ושמור על מה שתקין.

בעיות:
${issues.map((i) => `- ${i}`).join('\n')}

כללים:
- אסור לקצר. אם צוין שסעיף רדוד · העמק אותו, אל תמחק אותו. המאמר צריך להישאר 1100-1500 מילים.
- בעיה שמתחילה ב"חסר" · הוסף בפועל את האלמנט החסר. "חסר טבלה" = הוסף טבלת השוואה מלאה ב-Markdown. "חסר תשובה ישירה" = הוסף פסקת פתיחה מודגשת של 40-60 מילים. "חסר מה חשוב לזכור" = הוסף סעיף כזה. אל תתעלם מבעיית "חסר".
- טענה שסומנה כלא-מבוססת · או שתבסס אותה מהמחקר, או שתמחק אותה. אל תרכך אותה במילים.
- ניסוח שסומן כתרגומי · שכתב אותו בעברית מקורית.
- בלי מקפים ארוכים (המפריד הוא ·), בלי הבטחות תוצאה, Markdown בלבד, בלי frontmatter.
- החזר אך ורק את גוף המאמר. בלי שום משפט פתיחה כמו "להלן המאמר המתוקן" או "תיקנתי את...". המילה הראשונה בתשובה היא המילה הראשונה של המאמר.

המאמר:
${md}`,
    { maxTokens: 16000, timeoutMs: 180_000, model: fixModelForRound(round) },
  );
  return stripPreamble(text);
}

/**
 * מסיר פרימבל של המודל · "להלן המאמר המתוקן. כל סעיף טופל..." דלף לגוף
 * המאמר, וגם הפך לתקציר הכרטיס. מאמר תקין פותח ב-** (תשובה ישירה) או ב-##.
 * אם יש טקסט לפני זה · הוא פרימבל, זורקים אותו.
 */
function stripPreamble(text) {
  const s = (text || '').trim();
  const m = s.match(/(\*\*|##\s|#\s)/);
  if (m && m.index > 0 && m.index < 600) return s.slice(m.index).trim();
  return s;
}

/** מאמר אחד, מקצה לקצה. onStep מדווח שלב כדי שהלוג יהיה חי. */
/**
 * שלבי הכתיבה בשפת לקוח.
 * "סבב תיקון 1" ו"סבב הצלה אחרון" הם ז'רגון פנימי שלנו · הם דלפו ללקוח
 * ולא אמרו לו כלום. כל שלב כאן מסביר מה באמת קורה עכשיו.
 */
const FIX_STEP = [
  'מגיה, מהדק ניסוחים ומחדד את הטענות',
  'מעביר את המאמר בין שני מודלים שונים כדי לחדד אותו',
  'מאמת כל טענה מול המקורות ומסלק כל מה שלא מבוסס',
  'ליטוש אחרון · מסיר חזרתיות ומשלים פערים',
];
const fixStep = (r) => FIX_STEP[Math.min(Math.max(1, r) - 1, FIX_STEP.length - 1)];

export async function buildArticle(topic, store, onStep) {
  await onStep('חוקר את הנושא ואוסף מקורות מהרשת');
  const { brief, sources } = await research(topic, store);

  await onStep('כותב את המאמר');
  // write מחזיר {md, takeaways, faq} · הגוף עובר בקרה, ה-meta נלווה לתוצאה
  const written = await write(topic, store, brief);
  let md = written.md;
  md = stripPreamble(md);  // ליתר ביטחון · פרימבל לא נכנס לגוף

  await onStep('מריץ 5 בדיקות איכות במקביל · עובדות, לשון, מבנה, עיגון וציות');
  let issues = [...lint(md), ...(await qaAll(md, brief))];

  for (let round = 1; round <= MAX_FIX_ROUNDS && issues.length; round++) {
    await onStep(fixStep(round));
    md = await fix(md, issues, round);
    await onStep('בודק שוב מול כל חמש העדשות');
    issues = [...lint(md), ...(await qaAll(md, brief))];
  }

  await onStep('בודק אורך, מבנה ועומק של כל סעיף');
  let residual = [...lint(md), ...issues];

  // ניסיון אחרון על בעיות קשות · הליד הובטח שני מאמרים, לא מוותרים על
  // אחד בגלל פסקה קטועה שאפשר לתקן.
  if (hasHardIssue(residual)) {
    const hard = residual.filter((i) => HARD_ISSUE_RE.test(String(i)));
    await onStep('מתקן את מה שהבקרה עוד סימנה');
    md = await fix(md, hard, MAX_FIX_ROUNDS);
    await onStep('אימות אחרון לפני מסירה');
    residual = [...lint(md), ...(await qaAll(md, brief))];
  }

  const shelved = hasHardIssue(residual);

  return {
    title: topic.title,
    md,
    why: written.why || '',                // "למה כתבנו לך את זה" · תיחום צבעוני
    takeaways: written.takeaways || [],   // "בקצרה ל-AI"
    faq: written.faq || [],                // שאלות ותשובות · פורמט GEO
    sources: sources.slice(0, 8),
    shelved,
    // אם נשארו בעיות קשות · מסמנים ולא מתחזים לנקי
    residual: residual.slice(0, 5),
  };
}

/** שני המאמרים · במקביל. */
export async function buildBoth(store, score, onProgress) {
  const topics = await pickTopics(store, score);
  const ORD = ['מאמר ראשון', 'מאמר שני'];
  const state = topics.map((t, i) => ({ id: t.title, ord: ORD[i] || `מאמר ${i + 1}`, title: t.title, phase: 'ממתין בתור', done: false }));
  const emit = () => onProgress(state.map((s) => ({ ...s })));
  await emit();

  const results = await Promise.all(
    topics.map((topic, i) =>
      buildArticle(topic, store, async (phase) => { state[i].phase = phase; await emit(); })
        .then(async (a) => { state[i].phase = a.shelved ? 'מוכן · סימנו בו דברים לשיפור' : 'מוכן'; state[i].done = true; await emit(); return a; })
        .catch(async (e) => { state[i].phase = 'לא הצלחנו להשלים אותו'; state[i].done = true; await emit(); console.error('article failed', topic.title, e?.message); return null; }),
    ),
  );
  return results.filter(Boolean);
}
