/**
 * GET /api/scan/status?job=<id> · פרוקסי דק ל-Firestore דרך המכונה.
 * Firestore עקבי-חזק, אז הלוג באמת חי. KV היה מפגר עד 60 שניות.
 */
import { type Env, trim, machine, okJobId } from '../_scan-lib';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const id = trim(new URL(request.url).searchParams.get('job'), 64);
  if (!id || !okJobId(id)) return Response.json({ error: 'missing_job' }, { status: 400 });

  let job: any;
  try {
    const r = await machine(env, `/state?job=${encodeURIComponent(id)}`);
    if (r.status === 404) return Response.json({ error: 'not_found' }, { status: 404 });
    if (!r.ok) throw new Error(String(r.status));
    job = await r.json();
  } catch {
    return Response.json({ error: 'unavailable' }, { status: 503 });
  }

  // ג'וב שלא זז 4 דקות ואינו סופי · מת. פריסה או מיחזור instance הורגים
  // ריצה באמצע, ובלי השער הזה המשתמש רואה ספינר עד סוף הזמן.
  const STALE_MS = 4 * 60 * 1000;
  const idle = Date.now() - (job.updatedAt || job.startedAt || 0);
  if (!['done', 'error'].includes(job.phase) && idle > STALE_MS) {
    job = {
      ...job, phase: 'error',
      error: { title: 'הריצה נקטעה', message: 'משהו קטע אותנו באמצע · אפשר להתחיל מחדש והפעם זה ירוץ עד הסוף.' },
    };
  }

  // _debug נשאר במכונה · לא חושפים סיבות-שורש למשתמש
  return Response.json(
    {
      phase: job.phase, startedAt: job.startedAt, store: job.store,
      scan: job.scan, score: job.score, articles: job.articles, gen: job.gen, error: job.error,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
};

export const onRequest: PagesFunction<Env> = async () =>
  new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET' } });
