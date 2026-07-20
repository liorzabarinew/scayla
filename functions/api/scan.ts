/**
 * POST /api/scan · שער הכניסה. עושה רק מה שהקצה טוב בו:
 * honeypot → ולידציה → Turnstile → dedupe → תקרה → מסירה למכונה ב-Cloud Run.
 *
 * אפס עבודה ארוכה כאן. זה בדיוק מה שנכשל קודם.
 */
import {
  type Env, cleanHost, okHost, verifyTurnstile, newId, trim, domKey, capKey, ipKey, machine,
} from './_scan-lib';

const DEFAULT_CAP = 40;
const DEFAULT_IP_CAP = 3;
const STALE_MS = 5 * 60 * 1000;
// נעילת דומיין קבועה · דומיין שנסרק בהצלחה לא ייסרק שוב. ג'וב כושל משחרר
// את עצמו (הקוד מוחק את המפתח), אז שנה שלמה בטוחה · KV מוחק אוטומטית.
const DOM_TTL = 60 * 60 * 24 * 365;
const CAP_TTL = 60 * 60 * 36;

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad_json' }, { status: 400 }); }

  // מלכודת ספאם · 200 שקט, בלי לשרוף קריאה
  if (trim(body.company_website)) return Response.json({ ok: true });

  const host = cleanHost(trim(body.store, 200));
  const blog = trim(body.blog, 200);
  if (!host || !okHost(host)) return Response.json({ error: 'bad_url' }, { status: 400 });

  const ip = request.headers.get('cf-connecting-ip') || undefined;
  const ts = await verifyTurnstile(env, trim(body.cf_turnstile_response, 4000), ip);
  if (!ts.ok) return Response.json({ error: 'turnstile', why: ts.why }, { status: 400 });

  if (!env.SCAN_JOBS || !env.MACHINE_URL) return Response.json({ error: 'not_configured' }, { status: 503 });

  // תקרת IP יומית · מונעת ממחשב אחד לסובב הרבה דומיינים ולקצור תוכן.
  const ipCap = Number(env.SCAN_IP_CAP || DEFAULT_IP_CAP);
  const ipUsed = ip ? Number((await env.SCAN_JOBS.get(ipKey(ip))) || 0) : 0;
  if (ip && ipUsed >= ipCap) return Response.json({ error: 'ip_cap' }, { status: 429 });

  // נתיב-מהיר · סריקה אחת לדומיין. ג'וב כושל משחרר את עצמו (נמחק), אחרת
  // ליד שהסריקה שלו קרסה היה נחסם שנה. הנעילה האטומית נגד 8-במקביל
  // יושבת במכונה (Firestore transaction) · כאן זה רק קיצור-דרך.
  const seen = await env.SCAN_JOBS.get(domKey(host));
  if (seen) {
    try {
      const r = await machine(env, `/state?job=${encodeURIComponent(seen)}`);
      if (r.ok) {
        const j: any = await r.json();
        const live = j.phase === 'score' || j.phase === 'done' ||
          (j.phase !== 'error' && Date.now() - (j.updatedAt || 0) < STALE_MS);
        if (live) return Response.json({ jobId: seen, phase: j.phase, scan: j.scan, reused: true });
      }
    } catch { /* המכונה לא זמינה · נרוץ מחדש */ }
    await env.SCAN_JOBS.delete(domKey(host));
  }

  const cap = Number(env.SCAN_DAILY_CAP || DEFAULT_CAP);
  const used = Number((await env.SCAN_JOBS.get(capKey())) || 0);
  if (used >= cap) return Response.json({ error: 'scan_cap' }, { status: 503 });

  const id = newId(host);
  const r = await machine(env, '/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: id, host, blog }),
  });
  if (!r.ok) {
    console.error('machine /start failed', r.status, (await r.text()).slice(0, 200));
    return Response.json({ error: 'machine_unavailable' }, { status: 503 });
  }

  // המכונה היא הבוררת · נעילת הדומיין האטומית שם עשויה להחזיר ג'וב קיים
  // (reused) אם דומיין נסרק כבר או אם בקשה מקבילה כבר תפסה אותו.
  const out: any = await r.json().catch(() => ({}));
  const finalId = out.jobId || id;
  const reused = !!out.reused;

  if (!reused) {
    // רק ריצה אמיתית חדשה סופרת מול התקרות ונועלת את הדומיין.
    await env.SCAN_JOBS.put(domKey(host), finalId, { expirationTtl: DOM_TTL });
    await env.SCAN_JOBS.put(capKey(), String(used + 1), { expirationTtl: CAP_TTL });
    if (ip) await env.SCAN_JOBS.put(ipKey(ip), String(ipUsed + 1), { expirationTtl: CAP_TTL });
  }

  return Response.json({
    jobId: finalId, reused, phase: reused ? (out.phase || 'scanning') : 'scanning',
    scan: reused ? undefined : { steps: [
      { label: 'קוראים את החנות', state: 'running' },
      { label: 'סורקים את הבלוג', state: blog ? 'pending' : 'skipped' },
      { label: 'מרכיבים שאלות קונה מהחנות שלכם', state: 'pending' },
      { label: 'שואלים את ה-AI שאלות קונה', state: 'pending' },
      { label: 'בודקים מי מופיע בתשובות', state: 'pending' },
    ] },
  });
};

export const onRequest: PagesFunction<Env> = async () =>
  new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
