/**
 * POST /api/wp-signup · הרשמה לחיבור אתר WordPress / WooCommerce ל-Scayla.
 *
 * למה זה קיים: התוסף Scayla Connect מוגש לספריית wordpress.org. בודק מטעמם
 * לוחץ על "התקנה לוורדפרס" באתר ומצפה להגיע לזרימה אמיתית · לא ל"בקרוב"
 * ולא לרשימת המתנה. הנקודה הזו היא הזרימה האמיתית: היא מאמתת, שומרת את
 * הפנייה בשני יעדים בלתי-תלויים, ומחזירה למשתמש את השלבים הבאים.
 *
 * שני סינקים עצמאיים · בדיוק כמו ב-quizz.ts: גיליון Google (המאגר) וטלגרם
 * (התראה מיידית). מספיק שאחד הצליח כדי להחזיר 200 · פנייה לא הולכת לאיבוד.
 *
 * env:
 *   GOOGLE_SA          · מפתח ה-service-account (JSON) · אותו סוד של quizz
 *   QUIZZ_SHEET_ID     · ה-id של גיליון הלידים
 *   WP_SHEET_TAB       · שם הטאב · ברירת מחדל "WordPress" (נוצר אוטומטית אם חסר)
 *   TELEGRAM_BOT_TOKEN · בוט ההתראות
 *   TELEGRAM_CHAT_ID   · יעד ההתראה
 */

interface Env {
  GOOGLE_SA?: string;
  QUIZZ_SHEET_ID?: string;
  WP_SHEET_TAB?: string;
  TELEGRAM_BOT_TOKEN?: string;
  TELEGRAM_CHAT_ID?: string;
}

const COLUMNS = [
  { key: 'ts', label: 'תאריך' },
  { key: 'site', label: 'כתובת האתר' },
  { key: 'email', label: 'אימייל' },
  { key: 'name', label: 'שם' },
  { key: 'platform', label: 'פלטפורמה' },
  { key: 'note', label: 'הערה' },
  { key: 'src', label: 'מקור' },
];

const trim = (v: unknown, max = 500) => String(v ?? '').slice(0, max).trim();
const okEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v);

/** מנרמל כתובת אתר · מוסיף https אם חסר, ומאמת שזה host אמיתי. */
const normalizeSite = (raw: string): string | null => {
  const v = raw.replace(/\s+/g, '');
  if (!v) return null;
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  try {
    const u = new URL(withScheme);
    if (!/^[a-z0-9.-]+\.[a-z]{2,}$/i.test(u.hostname)) return null;
    if (/^(localhost|127\.|10\.|192\.168\.)/i.test(u.hostname)) return null;
    return u.origin + (u.pathname === '/' ? '' : u.pathname.replace(/\/$/, ''));
  } catch {
    return null;
  }
};

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
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion: `${unsigned}.${b64url(sig)}`,
    }),
  });
  if (!res.ok) throw new Error(`google token ${res.status}: ${await res.text()}`);
  return (await res.json<{ access_token: string }>()).access_token;
};

/** יוצר את הטאב אם עוד אינו קיים, וכותב שורת-כותרות · אידמפוטנטי. */
const ensureTab = async (sheetId: string, token: string, tab: string) => {
  const res = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${sheetId}:batchUpdate`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ requests: [{ addSheet: { properties: { title: tab } } }] }),
  });
  if (!res.ok) return; // כבר קיים (או שאין הרשאה) · ה-append שאחריו יכריע
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${sheetId}` +
      `/values/${encodeURIComponent(tab)}!A1:append?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`,
    {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ values: [COLUMNS.map((c) => c.label)] }),
    },
  );
};

const appendRow = async (env: Env, row: string[]) => {
  if (!env.GOOGLE_SA || !env.QUIZZ_SHEET_ID) throw new Error('sheet not configured');
  const sa = JSON.parse(env.GOOGLE_SA);
  const token = await googleToken(sa);
  const tab = env.WP_SHEET_TAB || 'WordPress';
  const url =
    `https://sheets.googleapis.com/v4/spreadsheets/${env.QUIZZ_SHEET_ID}` +
    `/values/${encodeURIComponent(tab)}!A1:append` +
    `?valueInputOption=USER_ENTERED&insertDataOption=INSERT_ROWS`;
  const post = () =>
    fetch(url, {
      method: 'POST',
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
      body: JSON.stringify({ values: [row] }),
    });

  let res = await post();
  if (!res.ok) {
    // סיבה סבירה יחידה: הטאב עוד לא נוצר · יוצרים ומנסים שוב פעם אחת.
    await ensureTab(env.QUIZZ_SHEET_ID, token, tab);
    res = await post();
  }
  if (!res.ok) throw new Error(`sheets append ${res.status}: ${await res.text()}`);
};

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

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'bad_json' }, { status: 400 });
  }

  // מלכודת-בוטים · שדה מוסתר שאדם לעולם לא ממלא.
  if (trim(body.company_website)) return Response.json({ ok: true });

  const site = normalizeSite(trim(body.site, 300));
  const email = trim(body.email, 200).toLowerCase();
  const name = trim(body.name, 120);
  const note = trim(body.note, 500);

  const errors: Record<string, string> = {};
  if (!site) errors.site = 'צריך כתובת אתר תקינה, למשל example.co.il';
  if (!okEmail(email)) errors.email = 'צריך כתובת אימייל תקינה';
  if (Object.keys(errors).length) return Response.json({ ok: false, errors }, { status: 422 });

  const ts = new Date().toISOString();
  const row = [ts, site!, email, name, 'WordPress / WooCommerce', note, 'wordpress-page'];

  const msg =
    `🟣 <b>הרשמה חדשה · WordPress</b>\n` +
    `אתר: ${esc(site!)}\n` +
    `אימייל: ${esc(email)}\n` +
    (name ? `שם: ${esc(name)}\n` : '') +
    (note ? `הערה: ${esc(note)}\n` : '');

  const [sheet, tg] = await Promise.allSettled([appendRow(env, row), telegram(env, msg)]);
  // מספיק שיעד אחד קלט · פנייה לא הולכת לאיבוד בגלל תקלה בצד אחד.
  if (sheet.status === 'rejected' && tg.status === 'rejected') {
    return Response.json({ ok: false, error: 'sink_failed' }, { status: 502 });
  }
  return Response.json({ ok: true });
};

export const onRequest: PagesFunction<Env> = async () =>
  new Response('method not allowed', { status: 405, headers: { allow: 'POST' } });
