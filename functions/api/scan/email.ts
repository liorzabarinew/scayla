/**
 * POST /api/scan/email · השער. מקבל שם + מייל ומתחיל את כתיבת המאמרים.
 * העבודה עצמה (15-25 דק׳) רצה ב-Cloud Run · כאן רק מוסרים אותה.
 */
import { type Env, trim, machine, okJobId } from '../_scan-lib';

const okEmail = (v: string) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim());

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  let body: any;
  try { body = await request.json(); } catch { return Response.json({ error: 'bad_json' }, { status: 400 }); }

  const jobId = trim(body.jobId, 64);
  const name = trim(body.name, 80);
  const email = trim(body.email, 160);
  if (!jobId || !okJobId(jobId)) return Response.json({ error: 'bad_job' }, { status: 400 });
  if (!okEmail(email)) return Response.json({ error: 'bad_email' }, { status: 400 });

  try {
    const r = await machine(env, '/email', {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jobId, name, email }),
    });
    if (!r.ok) throw new Error(`machine ${r.status}`);
    return Response.json({ ok: true }, { status: 202 });
  } catch {
    return Response.json({ error: 'machine_unavailable' }, { status: 503 });
  }
};

export const onRequest: PagesFunction<Env> = async () =>
  new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
