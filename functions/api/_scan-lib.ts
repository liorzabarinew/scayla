/**
 * שכבה דקה בין העמוד למכונה · ה-Pages Function עושה רק מה שהקצה טוב בו:
 * Turnstile, ולידציה, dedupe ותקרות. כל העבודה האמיתית (סריקה, Gemini,
 * מאמרים) רצה ב-Cloud Run על GCP · scan-machine/.
 *
 * למה לא כאן: waitUntil נהרג בפרודקשן אחרי ~30 שניות והשאיר ג'ובים תקועים
 * על 3/8, ול-KV יש מטמון-קצה של עד 60 שניות שהפך לוג "חי" ללוג שמפגר בדקה.
 * שניהם נצפו, לא נוחשו. Cloud Run מריץ את זה כלולאת Node רגילה.
 */

export interface Env {
  MACHINE_URL?: string;
  MACHINE_SECRET?: string;
  GOOGLE_SA?: string;
  TURNSTILE_SECRET_KEY?: string;
  SCAN_JOBS?: KVNamespace;
  SCAN_DAILY_CAP?: string;
  SCAN_IP_CAP?: string;
}

// ── דומיין ──
export const cleanHost = (v: string) =>
  String(v || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/:\d+$/, '');

export const okHost = (v: string) => /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9-]+)+$/.test(cleanHost(v));

/**
 * דומיין-רושם (eTLD+1) · מקפל תת-דומיינים ונתיבים לאותה יחידה, כדי
 * שסריקה אחת לדומיין תחסום גם את m.example.com ואת example.com/path.
 * לא רשימת PSL מלאה · מכסה את ה-TLDs הדו-שכבתיים הנפוצים (בעיקר IL).
 */
const MULTI_TLD = new Set([
  'co.il', 'org.il', 'ac.il', 'gov.il', 'net.il', 'muni.il', 'idf.il',
  'co.uk', 'org.uk', 'com.au', 'net.au', 'co.nz', 'co.za', 'com.br', 'co.jp', 'com.tr',
]);
export const registrableDomain = (v: string) => {
  const h = cleanHost(v);
  const p = h.split('.');
  if (p.length <= 2) return h;
  const last2 = p.slice(-2).join('.');
  return (MULTI_TLD.has(last2) ? p.slice(-3) : p.slice(-2)).join('.');
};

export const trim = (v: unknown, max = 400) => String(v ?? '').slice(0, max).trim();

/**
 * מזהה הג'וב = גם ה-URL של הליד: weshoes-co-il-a3f9c2
 * הדומיין נותן קישור שנראה כמו העמוד שלו ולא כמו פרמטר, והטוקן האקראי
 * מונע ניחוש · בלעדיו כל אחד היה יכול לקרוא סריקה של חנות אחרת.
 */
export const newId = (host: string) => {
  const b = new Uint8Array(4);
  crypto.getRandomValues(b);
  const token = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  const slug = cleanHost(host).replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40);
  return `${slug}-${token}`;
};

/** מקבל רק את הצורה שאנחנו מייצרים · חוסם path-traversal ושטויות. */
export const okJobId = (v: string) => /^[a-z0-9-]{6,60}$/.test(v);

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

// ── identity token ל-Cloud Run · השירות מוגן ב-IAM ──
const b64url = (buf: ArrayBuffer | string) => {
  const bytes = typeof buf === 'string' ? new TextEncoder().encode(buf) : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

let _idTok: { v: string; exp: number } | null = null;
const identityToken = async (env: Env, audience: string) => {
  const now = Math.floor(Date.now() / 1000);
  if (_idTok && _idTok.exp - 60 > now) return _idTok.v;
  if (!env.GOOGLE_SA) throw new Error('GOOGLE_SA missing');
  const sa = JSON.parse(env.GOOGLE_SA);
  const claim = {
    iss: sa.client_email, sub: sa.client_email,
    aud: 'https://oauth2.googleapis.com/token',
    target_audience: audience, iat: now, exp: now + 3600,
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
  if (!r.ok) throw new Error(`identity token ${r.status}: ${(await r.text()).slice(0, 120)}`);
  const j = await r.json<{ id_token: string }>();
  _idTok = { v: j.id_token, exp: now + 3500 };
  return j.id_token;
};

/** קריאה למכונה · IAM + shared secret. */
export const machine = async (env: Env, path: string, init: RequestInit = {}) => {
  if (!env.MACHINE_URL) throw new Error('MACHINE_URL missing');
  const tok = await identityToken(env, env.MACHINE_URL);
  return fetch(env.MACHINE_URL + path, {
    ...init,
    headers: {
      ...(init.headers || {}),
      authorization: `Bearer ${tok}`,
      'x-machine-secret': env.MACHINE_SECRET || '',
    },
  });
};

// ── dedupe + תקרות · KV הוא נתיב-מהיר; הנעילה האטומית האמיתית נגד
//    8-במקביל יושבת ב-Cloud Run (Firestore transaction), לא כאן. ──
export const domKey = (host: string) => `dom:${registrableDomain(host)}`;
export const capKey = () => `cap:${new Date().toISOString().slice(0, 10)}`;
export const ipKey = (ip: string) => `ip:${ip}:${new Date().toISOString().slice(0, 10)}`;
