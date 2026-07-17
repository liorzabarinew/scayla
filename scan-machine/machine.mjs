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
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const REGION = process.env.GCP_REGION || 'us-central1';
const VERTEX = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/publishers/google/models/${MODEL}:generateContent`;

// ── Vertex · ה-SDK מטפל בטוקן. אין יותר JWT ידני ב-WebCrypto. ──
const auth = new GoogleAuth({ scopes: 'https://www.googleapis.com/auth/cloud-platform' });
let _client;
const token = async () => {
  _client ??= await auth.getClient();
  const t = await _client.getAccessToken();
  return t.token;
};

export async function callGemini(prompt, opts = {}) {
  const gen = { maxOutputTokens: opts.maxTokens ?? 2000, temperature: opts.temperature ?? 0.4 };
  // gemini-2.5 סופר טוקני חשיבה בתוך maxOutputTokens · עם prompt אמיתי הם בלעו
  // את התקציב והתשובה חזרה קטועה. כבוי כברירת מחדל.
  if (!opts.think) gen.thinkingConfig = { thinkingBudget: 0 };
  if (opts.json) gen.responseMimeType = 'application/json';

  const body = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: gen };
  if (opts.grounded) body.tools = [{ googleSearch: {} }];

  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), opts.timeoutMs ?? 60_000);
  try {
    const r = await fetch(VERTEX, {
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

export async function scanStore(host, timeoutMs = 15_000) {
  const base = { host, ok: false, title: '', description: '', text: '', productCount: 0, isShopify: false };
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`https://${host}/`, {
      signal: ac.signal, redirect: 'follow',
      headers: { 'user-agent': 'ScaylaScan/1.0 (+https://scayla.co.il/scan)', accept: 'text/html' },
    });
    if (!r.ok) return { ...base, error: `http_${r.status}` };
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
    return { ...base, error: e?.name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally { clearTimeout(timer); }
}

export async function countProducts(host) {
  try {
    const r = await fetch(`https://${host}/products.json?limit=250`, {
      headers: { 'user-agent': 'ScaylaScan/1.0 (+https://scayla.co.il/scan)' },
    });
    if (!r.ok) return 0;
    const j = await r.json();
    return Array.isArray(j?.products) ? j.products.length : 0;
  } catch { return 0; }
}

// ── שאלות קונה ──
export async function buyerQuestions(s, n = 8) {
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

  const { text } = await callGemini(prompt, { json: true, maxTokens: 1200 });
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
    STEP('שואלים את Gemini', 'pending'),
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
  const qs = await buyerQuestions(store, 8);
  steps[2] = STEP(`הרכבנו ${qs.length} שאלות קונה מהחנות שלכם`, 'done');
  await emit();

  // 4. Gemini · לולאה רגילה. זהו.
  const brands = brandNamesFrom(store);
  const answers = [];
  let hit = 0;
  for (let i = 0; i < qs.length; i++) {
    steps[3] = STEP(`שואלים את Gemini · ${i}/${qs.length}`, 'running');
    await emit();
    let a;
    try {
      a = await callGemini(qs[i], { grounded: true, maxTokens: 2000, timeoutMs: 50_000 });
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
  steps[3] = STEP(`שאלנו את Gemini · ${answers.length} שאלות`, 'done');
  steps[4] = STEP(`הופעתם ב-${hit} מתוך ${answers.length} תשובות`, 'done');
  await emit({
    phase: 'score',
    score: { pct, band: bandOf(pct), queriesAsked: answers.length, queriesMentioned: hit, engines: ['gemini'], answers },
  });
}
