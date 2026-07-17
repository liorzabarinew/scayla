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

export async function countProducts(host) {
  try {
    const r = await fetch(`https://${host}/products.json?limit=250`, { headers: HDRS });
    if (!r.ok) return 0;
    const j = await r.json();
    return Array.isArray(j?.products) ? j.products.length : 0;
  } catch { return 0; }
}

// ── שאלות קונה ──
export async function buyerQuestions(s, n = 15) {
  const prompt = `אתה מנתח חנות אונליין ישראלית ומייצר שאלות שקונה אמיתי מקליד למנוע תשובות.

החנות: ${s.host}
כותרת: ${s.title}
תיאור: ${s.description}
טקסט מהעמוד: ${s.text.slice(0, 2500)}

צור בדיוק ${n} שאלות קנייה בעברית שקונה פוטנציאלי ישאל, כאלה שהחנות הזו אמורה להיות תשובה טובה להן.
כללים:
- שאלות גנריות של קטגוריה, לא שאלות על שם החנות. הקונה עוד לא מכיר אותה.
- כאלה שמזמינות המלצה על חנות או מותג ("איפה כדאי לקנות...", "מה החנות הכי טובה ל...").
- ספציפיות לנישה שזיהית, לא כלליות.
- אם רלוונטי, כלול הקשר ישראלי.
החזר מערך JSON של מחרוזות בלבד:
["שאלה 1", "שאלה 2"]`;

  const { text } = await callGemini(prompt, { json: true, maxTokens: 4000 });
  const raw = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let arr;
  try { arr = JSON.parse(raw); }
  catch {
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) throw new Error(`questions: no json (len=${text.length})`);
    arr = JSON.parse(m[0]);
  }
  const out = (Array.isArray(arr) ? arr : []).filter((x) => typeof x === 'string' && x.trim()).slice(0, n);
  if (!out.length) throw new Error('questions: none usable');
  return out;
}

// ── זיהוי אזכור · הקוד מחליט, לא המודל ──
export function detect(answer, host, brandNames) {
  const norm = (answer.text || '').toLowerCase();
  const names = [...brandNames, host.split('.')[0]]
    .map((x) => String(x || '').toLowerCase().trim()).filter((x) => x.length > 2);
  const byName = names.some((nm) => norm.includes(nm));
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
  const steps = [
    STEP('קוראים את החנות', 'running'),
    STEP('סורקים את הבלוג', blog ? 'pending' : 'skipped'),
    STEP('מרכיבים שאלות קונה מהחנות שלכם', 'pending'),
    STEP('שואלים את ה-AI שאלות קונה', 'pending'),
    STEP('בודקים מי מופיע בתשובות', 'pending'),
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
  if (store.isShopify) store.productCount = await countProducts(host);
  steps[0] = STEP(store.productCount ? `קראנו את החנות · ${store.productCount} מוצרים` : 'קראנו את החנות', 'done');
  await emit({ store: { host, title: store.title, isShopify: store.isShopify, products: store.productCount } });

  // 2. הבלוג · אופציונלי
  if (blog) {
    steps[1] = STEP('סורקים את הבלוג', 'running');
    await emit();
    const b = await scanStore(cleanHost(blog));
    steps[1] = STEP(b.ok ? 'קראנו את הבלוג' : 'הבלוג לא נענה · ממשיכים בלעדיו', b.ok ? 'done' : 'skipped');
    if (b.ok) store.text = (store.text + ' ' + b.text).slice(0, 8000);
    await emit();
  }

  // 3. שאלות
  steps[2] = STEP('מרכיבים שאלות קונה מהחנות שלכם', 'running');
  await emit();
  const qs = await buyerQuestions(store, 15);
  steps[2] = STEP(`הרכבנו ${qs.length} שאלות קונה מהחנות שלכם`, 'done');
  await emit();

  // 4. Gemini · לולאה רגילה. זהו.
  const brands = brandNamesFrom(store);
  const answers = [];
  let hit = 0;
  for (let i = 0; i < qs.length; i++) {
    steps[3] = STEP(`שואלים את ה-AI · ${i}/${qs.length}`, 'running');
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
  steps[3] = STEP(`שאלנו את ה-AI · ${answers.length} שאלות קונה`, 'done');
  steps[4] = STEP('מסכמים את המצב', 'running');
  await emit();

  const score = { pct, band: bandOf(pct), queriesAsked: answers.length, queriesMentioned: hit, engines: ['gemini'], answers };
  score.verdict = await verdictOf(store, score);

  steps[4] = STEP(`הופעתם ב-${hit} מתוך ${answers.length} תשובות`, 'done');
  await emit({ phase: 'score', score });
}
