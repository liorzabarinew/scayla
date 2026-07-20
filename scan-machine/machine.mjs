/**
 * מנוע הסריקה של /scan · Node רגיל על Cloud Run.
 *
 * למה כאן ולא על הקצה: הסריקה היא ~90 שניות, וצינור המאמרים יהיה 15-25 דקות.
 * ב-Cloudflare זה חייב מכונת-מצבים עם cursor וסולם alarms כדי לעקוף קיר של
 * 30 שניות. כאן זה פשוט קוד שרץ מלמעלה למטה. אין קיר, אין alarms, אין פיגור
 * מטמון · Firestore עקבי-חזק.
 *
 * הכלל היחיד שקובע: אם משהו לא נמדד · הוא לא מוחזר. אין ברירת-מחדל יפה,
 * אין fallback לנתונים מומצאים. עמוד בלי תג "הדגמה" חייב שכל מספר עליו
 * יהיה מדידה אמיתית.
 */
import { GoogleAuth } from 'google-auth-library';
import { Firestore } from '@google-cloud/firestore';

export const PROJECT = process.env.GCP_PROJECT || 'scayla-prod';
// pro כברירת מחדל · זה ה"וואו" שהלקוח רואה. flash נשמר רק למקום אחד
// שבו הוא נבחר בכוונה: המבקר הצולב, ששם המטרה היא מודל *שונה* מהכותב.
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-pro';
const REGION = process.env.GCP_REGION || 'us-central1';
const vertexUrl = (model = MODEL) =>
  `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/publishers/google/models/${model}:generateContent`;

// ── Vertex · ה-SDK מטפל בטוקן. אין יותר JWT ידני ב-WebCrypto. ──
const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
let _client;
const token = async () => {
  _client ??= await auth.getClient();
  const t = await _client.getAccessToken();
  return t.token;
};

export async function callGemini(prompt, opts = {}) {
  const model = opts.model || MODEL;

  // ── חשיבה: דלוקה. תמיד. ──
  // קודם כיביתי אותה (thinkingBudget:0) כי טוקני חשיבה בלעו את maxOutputTokens
  // וה-JSON חזר קטוע. זו הייתה אבחנה שגויה: הבעיה לא הייתה החשיבה אלא שלא
  // היה מספיק מקום לפלט. כיבוי החשיבה הוא לובוטומיה של המודל · הוא גם שבר את
  // pro לגמרי (400 · "does not support setting thinking_budget to 0").
  // הפתרון הנכון: חשיבה דינמית + מרווח פלט אמיתי. נמדד מול Vertex:
  // pro + thinkingBudget:-1 + 8000 → 200 STOP, 1770 טוקני חשיבה, פלט מלא.
  const gen = {
    maxOutputTokens: opts.maxTokens ?? 6000,
    temperature: opts.temperature ?? 0.4,
    thinkingConfig: { thinkingBudget: -1 },
  };
  if (opts.json) gen.responseMimeType = 'application/json';

  const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: gen };
  if (opts.grounded) body.tools = [{ googleSearch: {} }];

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 60_000);
  try {
    // opts.model · סולם התיקון מסלים מ-flash ל-pro בין סבבים
    const r = await fetch(vertexUrl(model), {
      method: 'POST', signal: ac.signal,
      headers: { authorization: `Bearer ${await token()}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = await r.json();
    const cand = j.candidates?.[0];
    const text = (cand?.content?.parts || []).map((p) => p.text || '').join('').trim();
    const sources = (cand?.groundingMetadata?.groundingChunks || [])
      .map((c) => ({ uri: c.web?.uri || '', domain: (c.web?.domain || '').toLowerCase() }))
      .filter((s) => s.domain);
    return { text, sources };
  } finally { clearTimeout(timer); }
}

// ── דומיין ──
export const cleanHost = (v) =>
  String(v || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
export const okHost = (v) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/.test(cleanHost(v));

// דומיין-רושם · מקפל www/תת-דומיין/נתיב, כדי להתאים תוצאת SERP לחנות.
const MULTI_TLD = new Set([
  'co.il', 'org.il', 'ac.il', 'gov.il', 'net.il', 'muni.il',
  'co.uk', 'com.au', 'co.nz', 'co.za', 'com.br', 'co.jp',
]);
export const registrableDomain = (v) => {
  const h = cleanHost(v);
  const p = h.split('.');
  if (p.length <= 2) return h;
  const l2 = p.slice(-2).join('.');
  return (MULTI_TLD.has(l2) ? p.slice(-3) : p.slice(-2)).join('.');
};

/**
 * SERP אמיתי ב-Google · Programmable Search (PSE). אות פנימי בלבד: מתחרים
 * אמיתיים + פערים (שאלות שבהן החנות חסרה מגוגל) להזנת בחירת המאמרים. לא
 * ציון שמוצג ליוזר · PSE נבדל מגוגל החי, לכן לא טוענים דירוג מדויק כלפי חוץ.
 * gl=il + hl=he + lr=lang_he · ממקד לתוצאות ישראליות/עבריות.
 */
export async function serpProbe(question, host, cx, key, num = 10) {
  const u = `https://www.googleapis.com/customsearch/v1?key=${encodeURIComponent(key)}&cx=${encodeURIComponent(cx)}&q=${encodeURIComponent(question)}&num=${num}&gl=il&hl=he&lr=lang_he`;
  const r = await fetch(u, { signal: AbortSignal.timeout(15_000) });
  if (!r.ok) throw new Error(`pse ${r.status}: ${(await r.text()).slice(0, 120)}`);
  const j = await r.json();
  const domains = (j.items || []).map((it) => registrableDomain(it.displayLink || it.link || '')).filter(Boolean);
  const reg = registrableDomain(host);
  const rank = domains.findIndex((d) => d === reg);
  return { domains, storeRank: rank >= 0 ? rank + 1 : null };
}

/**
 * חסם מכסה יומי קשיח ל-PSE · אף פעם לא חוצים את ה-free (100/יום). מזמינים
 * מכסה אטומית מול Firestore (עקבי-חזק, גם מול סריקות מקבילות): מחזיר כמה
 * שאילתות מותר להריץ עכשיו (0 עד want). 0 = הגענו לרף → מדלגים על השכבה,
 * אין serp בדוח, אפס תשלום. שמרני בכוונה · מזמינים מראש, כישלון-שאילתה עדיין
 * נספר, כדי שלעולם לא נחרוג.
 */
let _quotaDb;
// מפתח היום מיושר ל-Pacific · מכסת גוגל מתאפסת בחצות PT, אז יום-הספירה שלנו
// זהה ליום-המכסה של גוגל, ורף 90 באמת מבטיח שלא נחצה 100 באף חלון.
const pacificDay = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const pseDayDoc = () => {
  _quotaDb ??= new Firestore({ projectId: PROJECT });
  return _quotaDb.collection('pse_quota').doc(pacificDay());
};
async function reservePse(want, cap) {
  const ref = pseDayDoc();
  return ref.firestore.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const used = snap.exists ? (snap.data().count || 0) : 0;
    const grant = Math.max(0, Math.min(want, cap - used));
    if (grant > 0) {
      tx.set(ref, { count: used + grant, updatedAt: Date.now(), expireAt: new Date(Date.now() + 3 * 24 * 60 * 60 * 1000) }, { merge: true });
    }
    return grant;
  });
}

// ── סורק ──
const strip = (html) =>
  html.replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&')
    .replace(/&quot;/g, '"').replace(/&#\d+;/g, ' ').replace(/\s+/g, ' ').trim();
const metaOf = (html, re) => (html.match(re) || [])[1]?.trim() || '';

// חנויות אמיתיות חוסמות user-agent לא מוכר · weshoes.co.il החזיר
// store_unreachable אחרי כמה סריקות עם ה-UA המקורי שלנו. הסריקה יזומה
// על ידי בעל החנות עצמו על האתר שלו, אז דפדפן רגיל הוא הייצוג הנכון.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36';
const HDRS = {
  'user-agent': UA,
  accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
  'accept-language': 'he-IL,he;q=0.9,en;q=0.8',
  'accept-encoding': 'gzip, deflate, br',
  'cache-control': 'no-cache',
};

export async function scanStore(host, timeoutMs = 20_000, attempt = 1) {
  const base = { host, ok: false, title: '', description: '', text: '', productCount: 0, isShopify: false };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`https://${host}/`, { signal: ac.signal, redirect: 'follow', headers: HDRS });
    if (!r.ok) {
      // 403/429 = חסימה או קצב · ניסיון שני אחרי המתנה לפני שמוותרים
      if (attempt === 1 && [403, 429, 503].includes(r.status)) {
        clearTimeout(timer);
        await new Promise((ok) => setTimeout(ok, 2500));
        return scanStore(host, timeoutMs, 2);
      }
      return { ...base, error: `http_${r.status}` };
    }
    const html = (await r.text()).slice(0, 400_000);
    return {
      ...base, ok: true,
      isShopify: /cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i.test(html),
      title: strip(metaOf(html, /<title[^>]*>([\s\S]*?)<\/title>/i)).slice(0, 200),
      description: strip(
        metaOf(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) ||
        metaOf(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i),
      ).slice(0, 400),
      text: strip(html).slice(0, 6000),
    };
  } catch (e) {
    if (attempt === 1 && e?.name !== 'AbortError') {
      clearTimeout(timer);
      await new Promise((ok) => setTimeout(ok, 2000));
      return scanStore(host, timeoutMs, 2);
    }
    return { ...base, error: e?.name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally { clearTimeout(timer); }
}

/**
 * ספירת מוצרים אמיתית · products.json מחזיר עד 250 לעמוד.
 * קודם החזרנו את אורך העמוד הראשון, אז כל חנות עם 250+ מוצרים הציגה בדיוק
 * "250" לנצח · תקרה של הקוד שהתחזתה למדידה. ליאור קרא לזה חרטוט וצדק.
 * עכשיו: מדפדפים. אם עברנו את התקרה שלנו · מחזירים { atLeast } ולא מספר
 * מדויק, והטקסט אומר "מעל" ולא נוקב.
 */
export async function countProducts(host, maxPages = 8) {
  let total = 0;
  try {
    for (let page = 1; page <= maxPages; page++) {
      const r = await fetch(`https://${host}/products.json?limit=250&page=${page}`, { headers: HDRS });
      if (!r.ok) break;
      const j = await r.json();
      const n = Array.isArray(j?.products) ? j.products.length : 0;
      total += n;
      if (n < 250) return { count: total, exact: true };   // העמוד לא מלא · זה הסוף
    }
    // נגמרו העמודים שהסכמנו למשוך · אנחנו לא יודעים כמה יש באמת
    return { count: total, exact: false };
  } catch {
    return { count: total, exact: total > 0 ? false : true };
  }
}

// ── שאלות קונה ──
// מודדים נראות מול מרחב שאלות הקנייה האמיתי של הקטגוריה, לאורך כל מסע הקנייה.
// מהחנות מזהים קטגוריה וקהל בלבד, ומייצרים 16 שאלות קנייה מסחריות שקונה אמיתי
// בקטגוריה מקליד למנוע תשובות. כל שאלה היא שאלה שכל קונה בקטגוריה שואל, ולא
// שאלה שנגזרת מהחנות הספציפית · מדידה מייצגת של הקטגוריה, לא של אתר בודד.
export async function buyerQuestions(s, n = 16) {
  const prompt = `אתה חוקר שוק שמאפיין את מרחב שאלות הקנייה של קטגוריה שלמה.

לפניך דף הבית של חנות אונליין ישראלית. השתמש בו אך ורק כדי לזהות שני דברים:
(א) מהי הקטגוריה שהחנות מוכרת, ברוחב שקונה תופס אותה (למשל "נעלי ריצה", לא "המותגים הספציפיים של החנות הזו").
(ב) מיהו קהל הקונים.
אחרי שזיהית · שכח את החנות הזו. שכח את השם, המותגים, המבצעים והיתרונות שלה. מכאן אתה מייצג את הקונה בקטגוריה, לא את החנות.

החנות · לזיהוי קטגוריה וקהל בלבד:
כתובת: ${s.host}
כותרת: ${s.title}
תיאור: ${s.description}
טקסט מהעמוד: ${s.text.slice(0, 2500)}

צור בדיוק ${n} שאלות קנייה מסחריות בעברית שקונה ישראלי אמיתי בקטגוריה הזו מקליד ל-AI כשהוא בדרך לקנות. חלק אותן בדיוק כך, לפי הסדר:
1-2. איפה קונים · "איפה כדאי לקנות X אונליין בישראל", "איזו חנות מומלצת ל-X".
3-5. סוג ודרישה · "מה ה-X הכי טוב ל-Y", "איזה X מתאים ל-Z" (שלוש שאלות).
6-8. הכי טוב / מומלץ · "מה ה-X המומלץ ביותר בישראל", "מה המותג הכי טוב ל-X" (שלוש שאלות).
9-10. השוואה / חלופות · "X או Y · מה עדיף", "מה החלופות ל-X".
11-12. תקציב / תמורה · "איפה הכי משתלם לקנות X", "מה ה-X הכי טוב עד ₪...".
13-14. שימוש / קהל · "X ל[צורך או קהל אמיתי]" (רגליים רחבות, מתחילים, ילדים, מתנה וכו').
15-16. אמון / שירות · "איפה יש X עם החזרה חינם", "לאיזו חנות X יש משלוח מהיר ואחריות בישראל".

כללים קשיחים:
- אל תזכיר את שם החנות ואל תרמוז עליה.
- כל שאלה חייבת להיות שאלה מסחרית שחנות יכולה עקרונית להופיע בתשובה עליה. אסור שאלת מידע/בריאות/מודעות כללית שאף חנות לא עונה עליה · זו שאלה מיותרת שרק מדללת.
- מבחן חובה לכל שאלה: אילו מתחרה בקטגוריה היה מזמין את הבדיקה · אותה שאלה הייתה שייכת? אם היא הגיונית רק כ"פער של החנות הזו" · פסול והחלף.
- בלי מגבלת אזור/מחיר/מותג שכל תפקידה להוציא חנות מהתשובה. ניסוח טבעי כמו שקונה מקליד.
- אל תמציא תת-נישה שלא קיימת בקטגוריה. תישאר בקטגוריה שזיהית, ברוחב שקונה תופס.
- בלי מקפים ארוכים.

קריאה אחת. בלי טקסט לפני או אחרי. החזר אך ורק מערך JSON של ${n} מחרוזות, בסדר הקבוצות:
["שאלה 1", ... , "שאלה ${n}"]`;

  // temperature נמוך · דגימה יציבה ונאמנה למכסה, לא "יצירתית"
  const { text } = await callGemini(prompt, { json: true, maxTokens: 4000, temperature: 0.15 });
  const raw = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let arr;
  try { arr = JSON.parse(raw); }
  catch {
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) throw new Error(`questions: no json (len=${text.length})`);
    arr = JSON.parse(m[0]);
  }
  // לא זורקים על אורך שגוי · degradation רך. משתמשים במה שיש (זוגי למסך).
  let out = (Array.isArray(arr) ? arr : []).filter((x) => typeof x === 'string' && x.trim()).slice(0, n);
  if (!out.length) throw new Error('questions: none usable');
  if (out.length % 2 === 1) out = out.slice(0, out.length - 1); // זוגי · הגריד דורש
  return out;
}

// ── זיהוי אזכור · הקוד מחליט, לא המודל ──
// התאמת גבול-מילה (unicode) ולא substring · אחרת שם שמכיל מילת-קטגוריה
// (weshoes מכיל shoes) היה נספר כאזכור בכל תשובה שמזכירה את הקטגוריה, שזה
// זיהוי שגוי. byDomain (הדומיין במקורות העיגון) הוא האות המדויק והחזק.
const escRe = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function detect(answer, host, brandNames) {
  const norm = (answer.text || '').toLowerCase();
  const names = [...brandNames, host.split('.')[0]]
    .map((x) => String(x || '').toLowerCase().trim())
    .filter((x) => x.length >= 3);
  // גבול-מילה (unicode) · "shoes" לא תתפוס בתוך "weshoes", "נעל" לא בתוך "נעלה"
  const byName = names.some((nm) => new RegExp(`(^|[^\\p{L}\\p{N}])${escRe(nm)}([^\\p{L}\\p{N}]|$)`, 'u').test(norm));
  // האות החזק · תשובת ה-AI עוגנה בדומיין של החנות עצמה
  const byDomain = (answer.sources || []).some((s) => s.domain === host || s.domain.endsWith('.' + host));
  return { mentioned: byName || byDomain, byName, byDomain };
}

export function brandNamesFrom(s) {
  const out = new Set();
  const root = s.host.split('.')[0];
  if (root.length > 2) out.add(root);
  const head = (s.title || '').split(/[|·\-–—:]/)[0].trim();
  if (head && head.length > 2 && head.length < 40) out.add(head);
  return [...out];
}

export const bandOf = (pct) => (pct >= 50 ? 'lead' : pct >= 20 ? 'grow' : 'gap');

/**
 * סיכום המצב במילים · אדם קורא משפט, לא מחוון.
 * מעוגן קשיח: המודל מקבל רק את מה שנמדד ואסור לו להוסיף מספר או עובדה
 * משלו. אם הוא נופל · אין סיכום, ולא ממציאים אחד. עמוד בלי תג "הדגמה"
 * לא יציג משפט שלא נגזר ממדידה.
 */
export async function verdictOf(store, score) {
  const missed = score.answers.filter((a) => !a.mentioned).map((a) => a.q).slice(0, 3);
  const hitQs = score.answers.filter((a) => a.mentioned).map((a) => a.q).slice(0, 2);
  const prompt = `אתה כותב שתי שורות סיכום לבעל חנות אונליין ישראלית על תוצאות בדיקת נראות ב-AI.

עובדות מדודות · אלה כל העובדות שיש לך:
- החנות: ${store.title || store.host}
- נשאלו ${score.queriesAsked} שאלות קונה, החנות הופיעה ב-${score.queriesMentioned} מהן (${score.pct}%)
${hitQs.length ? `- הופיעה בשאלות כמו: ${hitQs.join(' | ')}` : '- לא הופיעה באף שאלה'}
${missed.length ? `- לא הופיעה בשאלות כמו: ${missed.join(' | ')}` : ''}

כתוב 2 משפטים קצרים בעברית, בגוף שני רבים ("אתם"), שמסכמים לבעל החנות את המצב שלו.
כללים קשיחים:
- אל תמציא שום מספר, עובדה, שם מתחרה או המלצה שלא מופיעים ברשימה למעלה.
- בלי הבטחות תוצאה ובלי סופרלטיבים שיווקיים.
- בלי מקפים ארוכים. המפריד הוא נקודה מפרידה ·
- משפט ראשון: איפה הם עומדים. משפט שני: מה זה אומר בפועל.
- אל תזכיר שם של מנוע AI מסוים (Gemini / ChatGPT). כתוב "ה-AI" או "מנועי תשובות".
החזר טקסט בלבד, בלי מרכאות.`;

  try {
    const { text } = await callGemini(prompt, { maxTokens: 3000, temperature: 0.5 });
    const clean = text.trim().replace(/^["']|["']$/g, '').replace(/—/g, '·');
    return clean.length > 20 && clean.length < 400 ? clean : null;
  } catch {
    return null; // אין סיכום · עדיף מאשר סיכום מומצא
  }
}
export const STEP = (label, state) => ({ label, state });

/**
 * הסריקה המלאה · פשוט רצה מלמעלה למטה.
 * onProgress נקרא אחרי כל שלב כדי שהלוג יהיה באמת חי.
 */
export async function runScan({ host, blog }, onProgress) {
  // כל השלבים מופיעים מההתחלה · הטיקים יורדים אחד־אחד. המשתמש רואה מראש
  // את כל העבודה שמחכה לו, וזה מה שמצדיק 16 דקות המתנה.
  const steps = [
    STEP('קוראים את החנות ואת הקטלוג', 'running'),
    STEP('סורקים את הבלוג', blog ? 'pending' : 'skipped'),
    STEP('מבינים מה אתם מוכרים ולמי', 'pending'),
    STEP('מרכיבים 16 שאלות שקונה אמיתי שואל', 'pending'),
    STEP('שואלים את ה-AI ומצליבים מול מקורות חיים', 'pending'),
    STEP('בודקים בכל תשובה מי מוזכר ומי חסר', 'pending'),
    STEP('מחשבים את ציון הנראות שלכם', 'pending'),
    STEP('בוחרים 2 נושאים מהפערים שנמצאו', 'pending'),
    STEP('כותבים את שני המאמרים', 'pending'),
    STEP('מגישים אותם לבקרת האיכות', 'pending'),
  ];
  const emit = (patch = {}) => onProgress({ scan: { steps }, ...patch });

  // 1. החנות
  const store = await scanStore(host);
  if (!store.ok) {
    const err = new Error('store_unreachable');
    err.userTitle = 'לא הצלחנו להגיע לחנות';
    err.userMessage = 'בדקו שהכתובת נכונה ושהאתר עלה, ונסו שוב.';
    throw err;
  }
  let prod = { count: 0, exact: true };
  if (store.isShopify) prod = await countProducts(host);
  store.productCount = prod.count;
  steps[0] = STEP(
    !prod.count ? 'קראנו את החנות'
      : prod.exact ? `קראנו את הקטלוג · ${prod.count} מוצרים`
      : `קראנו את הקטלוג · מעל ${prod.count} מוצרים`,
    'done',
  );
  await emit({ store: { host, title: store.title, isShopify: store.isShopify, products: prod.count, productsExact: prod.exact } });

  // 2. הבלוג · אופציונלי
  if (blog) {
    steps[1] = STEP('סורקים את הבלוג', 'running');
    await emit();
    const b = await scanStore(cleanHost(blog));
    steps[1] = STEP(b.ok ? 'קראנו את הבלוג' : 'הבלוג לא נענה · ממשיכים בלעדיו', b.ok ? 'done' : 'skipped');
    if (b.ok) store.text = (store.text + ' ' + b.text).slice(0, 8000);
    await emit();
  }
  steps[2] = STEP('מבינים מה אתם מוכרים ולמי', 'running');
  await emit();

  // 3. שאלות
  steps[2] = STEP('הבנו מה אתם מוכרים ולמי', 'done');
  steps[3] = STEP('מרכיבים 16 שאלות שקונה אמיתי שואל', 'running');
  await emit();
  const qs = await buyerQuestions(store, 16);
  steps[3] = STEP(`הרכבנו ${qs.length} שאלות שקונה אמיתי שואל`, 'done');
  await emit();

  // 4. Gemini · לולאה רגילה. זהו.
  const brands = brandNamesFrom(store);
  const answers = [];
  let hit = 0;
  for (let i = 0; i < qs.length; i++) {
    steps[4] = STEP(`שואלים את ה-AI ומצליבים מול מקורות חיים · שאלה ${i + 1} מתוך ${qs.length}`, 'running');
    await emit();
    let a;
    try {
      a = await callGemini(qs[i], { grounded: true, maxTokens: 4000, timeoutMs: 70_000 });
    } catch {
      // שאלה שנפלה לא נספרת · לא במונה ולא במכנה. תקלה אצלנו לא מורידה
      // ציון של חנות אמיתית.
      continue;
    }
    const d = detect(a, host, brands);
    if (d.mentioned) hit++;
    answers.push({ q: qs[i], engine: 'gemini', text: a.text.slice(0, 700), mentioned: d.mentioned, sources: a.sources.slice(0, 4) });
  }

  if (!answers.length) {
    const err = new Error('no_answers');
    err.userTitle = 'הבדיקה לא הושלמה';
    err.userMessage = 'לא הצלחנו לקבל תשובות כרגע · נסו שוב בעוד כמה דקות.';
    throw err;
  }

  // 5. הציון · נוסחת המוצר
  const pct = Math.round((100 * hit) / answers.length);
  steps[4] = STEP(`שאלנו את ה-AI ${answers.length} שאלות והצלבנו מול מקורות חיים`, 'done');
  steps[5] = STEP(`בדקנו בכל תשובה מי מוזכר · הופעתם ב-${hit} מתוך ${answers.length}`, 'done');
  steps[6] = STEP('מחשבים את ציון הנראות שלכם', 'running');
  await emit();

  const score = { pct, band: bandOf(pct), queriesAsked: answers.length, queriesMentioned: hit, engines: ['gemini'], answers };
  score.verdict = await verdictOf(store, score);

  // ── שכבת SERP פנימית · מתחרים + פערים בגוגל, להזנת בחירת המאמרים ──
  // flag-gated על PSE_CX+PSE_API_KEY · בלעדיהם מדלגים בשקט. עטוף לגמרי כדי
  // שכישלון PSE לעולם לא ישבור סריקה. לא מוצג ליוזר · אות פנימי בלבד.
  const PSE_CX = process.env.PSE_CX, PSE_KEY = process.env.PSE_API_KEY;
  if (PSE_CX && PSE_KEY) {
    try {
      const want = Math.min(qs.length, Number(process.env.PSE_MAX || 16));
      const cap = Number(process.env.PSE_DAILY_CAP || 90); // רף מתחת ל-100 של גוגל · אף פעם לא בתשלום
      const grant = await reservePse(want, cap); // חסם קשיח · 0 = הגענו לרף היומי → מדלגים
      if (grant > 0) {
        const reg = registrableDomain(host);
        const perQ = [];
        const freq = {};
        for (let i = 0; i < grant; i++) {
          try {
            const s = await serpProbe(qs[i], host, PSE_CX, PSE_KEY);
            perQ.push({ q: qs[i], storeRank: s.storeRank, top: s.domains.slice(0, 5) });
            for (const d of s.domains.slice(0, 10)) if (d && d !== reg) freq[d] = (freq[d] || 0) + 1;
          } catch { /* שאילתה שנפלה · מדלגים (כבר נספרה במכסה, שמרני) */ }
        }
        if (perQ.length) {
          const present = perQ.filter((x) => x.storeRank).length;
          const competitors = Object.entries(freq).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([domain, count]) => ({ domain, count }));
          const gaps = perQ.filter((x) => !x.storeRank).map((x) => x.q);
          score.serp = { asked: perQ.length, storePresent: present, storeHitRate: Math.round((100 * present) / perQ.length), competitors, gaps, perQ };
        }
      }
      // grant === 0 → הגענו לרף היומי · אין serp בדוח, לא feed למאמרים, אפס תשלום.
    } catch (e) { console.error('serp probe failed', e?.message); }
  }

  steps[6] = STEP(`ציון הנראות שלכם · ${pct}%`, 'done');
  steps[7] = STEP('בוחרים 2 נושאים מהפערים שנמצאו', 'running');
  await emit({ phase: 'score', score });
}
