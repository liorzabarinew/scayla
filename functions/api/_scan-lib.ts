/**
 * מנוע הסריקה של /scan · עצמאי לחלוטין ממכונת התוכן.
 *
 * לוקח משם לוגיקה בלבד (JWT→Vertex, זיהוי אזכור דטרמיניסטי), לא מייבא ולא כותב
 * לבנק התוכן. מאמר של ליד לעולם לא נכנס ל-src/content/magazine.
 *
 * הכלל היחיד שקובע כאן: אם משהו לא נמדד · הוא לא מוחזר. אין ברירת-מחדל יפה,
 * אין דמו, אין fallback לנתונים מומצאים. עמוד שמראה ציון בלי תג "הדגמה" חייב
 * שכל מספר עליו יהיה מדידה.
 */

export interface Env {
  GOOGLE_SA?: string;
  TURNSTILE_SECRET_KEY?: string;
  RESEND_API_KEY?: string;
  SCAN_JOBS?: KVNamespace;
  SCAN_DAILY_CAP?: string;
}

export const PROJECT = 'scayla-prod';
export const MODEL = 'gemini-2.5-flash';
export const REGION = 'us-central1';

// ── Vertex · JWT ב-WebCrypto. crypto.sign של Node לא קיים ב-Workers. ──
const b64url = (buf: ArrayBuffer | string) => {
  const bytes = typeof buf === 'string' ? new TextEncoder().encode(buf) : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

let _tok: { v: string; exp: number } | null = null;
export const vertexToken = async (env: Env) => {
  if (!env.GOOGLE_SA) throw new Error('GOOGLE_SA missing');
  const now = Math.floor(Date.now() / 1000);
  if (_tok && _tok.exp - 60 > now) return _tok.v;
  const sa = JSON.parse(env.GOOGLE_SA);
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/cloud-platform',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claim))}`;
  const pem = sa.private_key.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const key = await crypto.subtle.importKey(
    'pkcs8', Uint8Array.from(atob(pem), (c) => c.charCodeAt(0)).buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' }, false, ['sign'],
  );
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: `${unsigned}.${b64url(sig)}` }),
  });
  if (!r.ok) throw new Error(`vertex token ${r.status}`);
  const j = await r.json<{ access_token: string; expires_in: number }>();
  _tok = { v: j.access_token, exp: now + (j.expires_in || 3600) };
  return _tok.v;
};

const VERTEX_URL = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/publishers/google/models/${MODEL}:generateContent`;

export interface GeminiOut { text: string; sources: { uri: string; domain: string }[] }

export const callGemini = async (
  env: Env,
  prompt: string,
  opts: { grounded?: boolean; json?: boolean; think?: boolean; maxTokens?: number; timeoutMs?: number } = {},
): Promise<GeminiOut> => {
  const token = await vertexToken(env);
  const gen: any = { maxOutputTokens: opts.maxTokens ?? 2000, temperature: 0.4 };

  // gemini-2.5 סופר טוקני חשיבה בתוך maxOutputTokens. עם prompt אמיתי הם בלעו
  // את התקציב והתשובה נחתכה באמצע · JSON בלי סוגר, או תשובה קטועה. אנחנו לא
  // צריכים חשיבה לא לשאלות ולא לתשובות קונה, אז היא כבויה כברירת מחדל.
  if (!opts.think) gen.thinkingConfig = { thinkingBudget: 0 };
  // JSON מובנה · מבטל את גדרות ה-```json ואת הצורך לחלץ ב-regex
  if (opts.json) gen.responseMimeType = 'application/json';

  const body: any = { contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: gen };
  // grounding ו-responseMimeType לא הולכים יחד · העיגון מחזיר פרוזה
  if (opts.grounded) body.tools = [{ googleSearch: {} }];

  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), opts.timeoutMs ?? 45_000);
  try {
    const r = await fetch(VERTEX_URL, {
      method: 'POST', signal: ac.signal,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!r.ok) throw new Error(`gemini ${r.status}: ${(await r.text()).slice(0, 160)}`);
    const j = await r.json<any>();
    const cand = j.candidates?.[0];
    const text = (cand?.content?.parts || []).map((p: any) => p.text || '').join('').trim();
    const chunks = cand?.groundingMetadata?.groundingChunks || [];
    const sources = chunks
      .map((c: any) => ({ uri: c.web?.uri || '', domain: (c.web?.domain || '').toLowerCase() }))
      .filter((s: any) => s.domain);
    return { text, sources };
  } finally { clearTimeout(t); }
};

// ── נרמול דומיין ──
export const cleanHost = (v: string) =>
  String(v || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/:\d+$/, '');

export const okHost = (v: string) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/.test(cleanHost(v));

// ── סורק החנות · קורא אתר זר ומוציא ממנו טקסט ──
const strip = (html: string) =>
  html
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&quot;/g, '"')
    .replace(/&#\d+;/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();

const meta = (html: string, re: RegExp) => (html.match(re) || [])[1]?.trim() || '';

export interface StoreScan {
  host: string;
  ok: boolean;
  title: string;
  description: string;
  text: string;
  productCount: number;
  isShopify: boolean;
  error?: string;
}

export const scanStore = async (host: string, timeoutMs = 12_000): Promise<StoreScan> => {
  const base: StoreScan = { host, ok: false, title: '', description: '', text: '', productCount: 0, isShopify: false };
  const ac = new AbortController();
  const t = setTimeout(() => ac.abort(), timeoutMs);
  try {
    const r = await fetch(`https://${host}/`, {
      signal: ac.signal, redirect: 'follow',
      headers: { 'user-agent': 'ScaylaScan/1.0 (+https://scayla.co.il/scan)', accept: 'text/html' },
    });
    if (!r.ok) return { ...base, error: `http_${r.status}` };
    const html = (await r.text()).slice(0, 400_000);
    const title = meta(html, /<title[^>]*>([\s\S]*?)<\/title>/i);
    const description =
      meta(html, /<meta[^>]+name=["']description["'][^>]+content=["']([^"']+)/i) ||
      meta(html, /<meta[^>]+property=["']og:description["'][^>]+content=["']([^"']+)/i);
    const isShopify = /cdn\.shopify\.com|Shopify\.theme|myshopify\.com/i.test(html);
    return {
      ...base, ok: true, isShopify,
      title: strip(title).slice(0, 200),
      description: strip(description).slice(0, 400),
      text: strip(html).slice(0, 6000),
      productCount: 0,
    };
  } catch (e: any) {
    return { ...base, error: e?.name === 'AbortError' ? 'timeout' : 'unreachable' };
  } finally { clearTimeout(t); }
};

/** מספר המוצרים · רק לחנויות Shopify, דרך ה-endpoint הפומבי. best-effort. */
export const countProducts = async (host: string): Promise<number> => {
  try {
    const r = await fetch(`https://${host}/products.json?limit=250`, {
      headers: { 'user-agent': 'ScaylaScan/1.0 (+https://scayla.co.il/scan)' },
    });
    if (!r.ok) return 0;
    const j = await r.json<any>();
    return Array.isArray(j?.products) ? j.products.length : 0;
  } catch { return 0; }
};

// ── גזירת שאלות קונה מהחנות ──
export const buyerQuestions = async (env: Env, s: StoreScan, n = 8): Promise<string[]> => {
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

  const { text } = await callGemini(env, prompt, { json: true, maxTokens: 1200 });
  // responseMimeType מחזיר JSON נקי · החילוץ ב-regex נשאר כרשת ביטחון בלבד
  const raw = text.trim().replace(/^```(?:json)?/i, '').replace(/```$/, '').trim();
  let arr: unknown;
  try { arr = JSON.parse(raw); }
  catch {
    const m = raw.match(/\[[\s\S]*\]/);
    if (!m) throw new Error(`questions: no json (len=${text.length})`);
    arr = JSON.parse(m[0]);
  }
  if (!Array.isArray(arr) || !arr.length) throw new Error('questions: empty');
  const out = (arr as unknown[]).filter((x): x is string => typeof x === 'string' && !!x.trim()).slice(0, n);
  if (!out.length) throw new Error('questions: none usable');
  return out;
};

// ── זיהוי אזכור · דטרמיניסטי. הקוד מחליט, לא המודל. ──
export const detect = (answer: GeminiOut, host: string, brandNames: string[]) => {
  const norm = (answer.text || '').toLowerCase();
  const root = host.split('.')[0];
  const names = [...brandNames, root].map((x) => String(x || '').toLowerCase().trim()).filter((x) => x.length > 2);
  const byName = names.some((nm) => norm.includes(nm));
  const byDomain = (answer.sources || []).some((s) => s.domain === host || s.domain.endsWith('.' + host));
  return { mentioned: byName || byDomain, byName, byDomain };
};

/** שמות מותג אפשריים · מהכותרת של האתר. */
export const brandNamesFrom = (s: StoreScan) => {
  const out = new Set<string>();
  const root = s.host.split('.')[0];
  if (root.length > 2) out.add(root);
  const head = (s.title || '').split(/[|·\-–—:]/)[0].trim();
  if (head && head.length > 2 && head.length < 40) out.add(head);
  return [...out];
};

export const bandOf = (pct: number) => (pct >= 50 ? 'lead' : pct >= 20 ? 'grow' : 'gap');

// ── Turnstile ──
export const verifyTurnstile = async (env: Env, token: string, ip?: string) => {
  if (!env.TURNSTILE_SECRET_KEY) return { ok: false, why: 'not_configured' };
  if (!token) return { ok: false, why: 'missing_token' };
  const fd = new FormData();
  fd.append('secret', env.TURNSTILE_SECRET_KEY);
  fd.append('response', token);
  if (ip) fd.append('remoteip', ip);
  const r = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', { method: 'POST', body: fd });
  const j = await r.json<any>();
  return { ok: !!j.success, why: (j['error-codes'] || []).join(',') };
};

// ── ג'ובים ב-KV ──
export const JOB_TTL = 60 * 60 * 24 * 30; // 30 יום · הליד חוזר לעמוד שלו בקישור מהמייל

export const jobKey = (id: string) => `job:${id}`;
export const domKey = (host: string) => `dom:${host}`;
export const capKey = () => `cap:${new Date().toISOString().slice(0, 10)}`;

export const getJob = async (env: Env, id: string) => {
  const raw = await env.SCAN_JOBS?.get(jobKey(id));
  return raw ? JSON.parse(raw) : null;
};
export const putJob = async (env: Env, id: string, job: any) => {
  await env.SCAN_JOBS?.put(jobKey(id), JSON.stringify(job), { expirationTtl: JOB_TTL });
};

export const newId = () => {
  const b = new Uint8Array(12);
  crypto.getRandomValues(b);
  return [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
};

export const trim = (v: unknown, max = 400) => String(v ?? '').slice(0, max).trim();

export const STEP = (label: string, state: string) => ({ label, state });
