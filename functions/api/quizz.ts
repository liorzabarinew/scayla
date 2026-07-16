/**
 * POST /api/quizz · קולט הגשה משאלון הפיילוט (/quizz).
 *
 * שני סינקים עצמאיים · ליד לא הולך לאיבוד גם אם אחד מהם נופל:
 *   1. Google Sheet · האחסון. גם לליאור וגם לנוי יש גישה (הגיליון משותף אליהם).
 *      נכתב דרך ה-service-account הקיים של scayla-prod, לא דרך שירות חדש.
 *   2. Telegram · פינג מיידי לליאור, דרך הבוט שכבר עובד במכונת התוכן.
 *
 * מספיק שאחד מהשניים הצליח כדי להחזיר 200. אם שניהם נפלו · 502, והדפדפן
 * מציג "נסו שוב" במקום לבלוע את הליד בשקט.
 *
 * סודות (Cloudflare Pages · Settings → Environment variables):
 *   GOOGLE_SA          · ה-JSON המלא של מפתח ה-service-account
 *   QUIZZ_SHEET_ID     · ה-id של הגיליון (מתוך ה-URL שלו)
 *   TELEGRAM_BOT_TOKEN · אותו טוקן של מכונת התוכן
 *   TELEGRAM_CHAT_ID   · הצ׳אט של ליאור
 */

interface Env {
  GOOGLE_SA?: string;
  QUIZZ_SHEET_ID?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
  QUIZZ_SHEET_TAB?: string;
}

/** העמודות של הגיליון · הסדר כאן הוא הסדר בגיליון. */
const COLUMNS: { key: string; label: string }[] = [
  { key: '_ts', label: 'תאריך' },
  { key: 'store', label: 'שם החנות' },
  { key: 'platform', label: 'פלטפורמה' },
  { key: 'what', label: 'מה מוכרים' },
  { key: 'age', label: 'ותק' },
  { key: 'traffic', label: 'תנועה' },
  { key: 'chg', label: 'שינוי מתוכנן' },
  { key: 'seo', label: 'קידום היום' },
  { key: 'bud', label: 'תקציב חודשי' },
  { key: 'pain', label: 'תסכול' },
  { key: 'gsc', label: 'GSC' },
  { key: 'ga4', label: 'GA4' },
  { key: 'inst', label: 'התקנה' },
  { key: 'apr', label: 'מי מאשר' },
  { key: 'cmt', label: 'התחייבות' },
  { key: 'cs', label: 'קייס סטאדי' },
  { key: 'nm', label: 'שם' },
  { key: 'ph', label: 'טלפון' },
  { key: 'em', label: 'מייל' },
  { key: 'more', label: 'הערות' },
];

const REQUIRED = [
  'store', 'platform', 'what', 'age', 'traffic',
  'seo', 'gsc', 'ga4', 'inst', 'apr', 'cmt', 'nm', 'ph', 'em',
];

const okEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());
const okPhone = (v: string) =>
  /^0(5\d{8}|7\d{8}|[23489]\d{7})$/.test(v.replace(/[\s\-().]/g, '').replace(/^\+972/, '0'));

/** גוזם כל שדה · חוסם payload מנופח מבוט. */
const trim = (v: unknown, max = 2000) => String(v ?? '').slice(0, max).trim();

// ── Google · JWT RS256 → access token ───────────────────────────────────────
const b64url = (buf: ArrayBuffer | string) => {
  const bytes = typeof buf === 'string' ? new TextEncoder().encode(buf) : new Uint8Array(buf);
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
};

const pemToKey = async (pem: string) => {
  const body = pem.replace(/-----(BEGIN|END) PRIVATE KEY-----/g, '').replace(/\s+/g, '');
  const raw = Uint8Array.from(atob(body), (c) => c.charCodeAt(0));
  return crypto.subtle.importKey(
    'pkcs8',
    raw.buffer,
    { name: 'RSASSA-PKCS1-v1_5', hash: 'SHA-256' },
    false,
    ['sign'],
  );
};

const googleToken = async (sa: { client_email: string; private_key: string }) => {
  const now = Math.floor(Date.now() / 1000);
  const claim = {
    iss: sa.client_email,
    scope: 'https://www.googleapis.com/auth/spreadsheets',
    aud: 'https://oauth2.googleapis.com/token',
    iat: now,
    exp: now + 3600,
  };
  const unsigned = `${b64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))}.${b64url(JSON.stringify(claim))}`;
  const key = await pemToKey(sa.private_key);
  const sig = await crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, new TextEncoder().encode(unsigned));
  const jwt = `${unsigned}.${b64url(sig)}`;

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: jwt,
    }),
  });
  if (!res.ok) throw new Error(`google token ${res.status}: ${await res.text()}`);
  return (await res.json<{ access_token: string }>()).access_token;
};

const appendRow = async (env: Env, row: string[]) => {
  if (!env.GOOGLE_SA || !env.QUIZZ_SHEET_ID) throw new Error('sheet not configured');
  const sa = JSON.parse(env.GOOGLE_SA);
  const token = await googleToken(sa);
  const tab = env.QUIZZ_SHEET_TAB || 'לידים';
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${env.QUIZZ_SHEET_ID}` +
    `/values/${encodeURIComponent(tab)}!A1:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const res = await fetch(url, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ values: [row] }),
  });
  if (!res.ok) throw new Error(`sheets append ${res.status}: ${await res.text()}`);
};

// ── Telegram ────────────────────────────────────────────────────────────────
const telegram = async (env: Env, text: string) => {
  if (!env.TELEGRAM_BOT_TOKEN || !env.TELEGRAM_CHAT_ID) throw new Error('telegram not configured');
  const res = await fetch(`https://api.telegram.org/bot${env.TELEGRAM_BOT_TOKEN}/sendMessage`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chat_id: env.TELEGRAM_CHAT_ID,
      text,
      parse_mode: 'HTML',
      disable_web_page_preview: true,
    }),
  });
  if (!res.ok) throw new Error(`telegram ${res.status}: ${await res.text()}`);
};

const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// ── handler ─────────────────────────────────────────────────────────────────
export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'bad json' }, { status: 400 });
  }

  // מלכודת ספאם · בוט שמילא את השדה המוסתר מקבל 200 ונזרק בשקט.
  if (trim(body.company_website)) return Response.json({ ok: true });

  const data: Record<string, string> = {};
  for (const { key } of COLUMNS) if (key !== '_ts') data[key] = trim(body[key]);

  // ולידציה בצד השרת · לא סומכים על הדפדפן.
  const missing = REQUIRED.filter((k) => !data[k]);
  if (missing.length) return Response.json({ ok: false, error: 'missing', missing }, { status: 400 });
  if (!okEmail(data.em)) return Response.json({ ok: false, error: 'bad email' }, { status: 400 });
  if (!okPhone(data.ph)) return Response.json({ ok: false, error: 'bad phone' }, { status: 400 });
  // הפיילוט הוא לשופיפיי בלבד · הדפדפן כבר חוסם, זה השער השני.
  if (data.platform !== 'Shopify') {
    return Response.json({ ok: false, error: 'platform not supported' }, { status: 400 });
  }

  const ts = new Date().toLocaleString('he-IL', { timeZone: 'Asia/Jerusalem' });
  const row = COLUMNS.map(({ key }) => (key === '_ts' ? ts : data[key] || ''));

  const msg =
    `🎯 <b>הגשה חדשה לפיילוט</b>\n\n` +
    `<b>${esc(data.store)}</b>\n` +
    `${esc(data.nm)} · ${esc(data.ph)} · ${esc(data.em)}\n\n` +
    `ותק: ${esc(data.age)}\n` +
    `תנועה: ${esc(data.traffic)}\n` +
    `קידום היום: ${esc(data.seo)}${data.bud ? ` · ${esc(data.bud)}` : ''}\n` +
    `GSC: ${esc(data.gsc)}\n` +
    `GA4: ${esc(data.ga4)}\n` +
    `התקנה: ${esc(data.inst)}\n` +
    `מאשר: ${esc(data.apr)}\n` +
    `התחייבות: ${esc(data.cmt)}\n` +
    (data.pain ? `\nתסכול: ${esc(data.pain)}\n` : '') +
    (data.more ? `הערות: ${esc(data.more)}\n` : '') +
    `\n${ts}`;

  // שני הסינקים במקביל · אחד לא מפיל את השני.
  const [sheet, tg] = await Promise.allSettled([appendRow(env, row), telegram(env, msg)]);
  const failed = [sheet, tg].filter((r) => r.status === 'rejected') as PromiseRejectedResult[];
  for (const f of failed) console.error('quizz sink failed:', f.reason);

  // מספיק שאחד עבר · הליד נשמר.
  if (failed.length === 2) {
    return Response.json({ ok: false, error: 'all sinks failed' }, { status: 502 });
  }
  return Response.json({ ok: true });
};

/**
 * Fallback · onRequestPost קודם לו, אז לכאן מגיעות רק שיטות שאינן POST.
 * הטופס הוא POST בלבד · כל השאר 405.
 */
export const onRequest: PagesFunction<Env> = async () =>
  new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
