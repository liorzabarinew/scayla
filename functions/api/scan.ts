/**
 * POST /api/scan · שער הכניסה. עושה רק מה שהקצה טוב בו:
 * honeypot → ולידציה → Turnstile → dedupe → תקרה → מסירה למכונה ב-Cloud Run.
 *
 * אפס עבודה ארוכה כאן. זה בדיוק מה שנכשל קודם.
 */
import {
  type Env, cleanHost, okHost, verifyTurnstile, newId, trim, domKey, capKey, machine,
} from './_scan-lib';

const DEFAULT_CAP = 40;
const STALE_MS = 5 * 60 * 1000;

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

  // סריקה אחת לדומיין. ג'וב כושל או תקוע לא נחשב · אחרת ליד שהסריקה שלו
  // קרסה היה נחסם שבוע שלם בלי יכולת לנסות שוב.
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
  await env.SCAN_JOBS.put(capKey(), String(used + 1), { expirationTtl: 60 * 60 * 36 });

  const id = newId(host);
  const r = await machine(env, '/start', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jobId: id, host, blog }),
  });
  if (!r.ok) {
    console.error('machine /start failed', r.status, (await r.text()).slice(0, 200));
    return Response.json({ error: 'machine_unavailable' }, { status: 503 });
  }
  await env.SCAN_JOBS.put(domKey(host), id, { expirationTtl: 60 * 60 * 24 * 7 });

  return Response.json({
    jobId: id, phase: 'scanning',
    scan: { steps: [
      { label: 'קוראים את החנות', state: 'running' },
      { label: 'סורקים את הבלוג', state: blog ? 'pending' : 'skipped' },
      { label: 'מרכיבים שאלות קונה מהחנות שלכם', state: 'pending' },
      { label: 'שואלים את Gemini', state: 'pending' },
      { label: 'בודקים מי מופיע בתשובות', state: 'pending' },
    ] },
  });
};

export const onRequest: PagesFunction<Env> = async () =>
  new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
