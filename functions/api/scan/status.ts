/**
 * GET /api/scan/status?job=<id> · מצב הג'וב. מקור האמת היחיד של העמוד.
 * מחזיר רק מה שנמדד · אין ברירות-מחדל ואין השלמות.
 */
import { type Env, getJob, trim } from '../_scan-lib';

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const id = trim(new URL(request.url).searchParams.get('job'), 64);
  if (!id) return Response.json({ error: 'missing_job' }, { status: 400 });

  const job = await getJob(env, id);
  if (!job) return Response.json({ error: 'not_found' }, { status: 404 });

  return Response.json(
    {
      phase: job.phase,
      startedAt: job.startedAt,
      store: job.store,
      scan: job.scan,
      score: job.score,
      articles: job.articles,
      gen: job.gen,
      error: job.error,
    },
    { headers: { 'cache-control': 'no-store' } },
  );
};

export const onRequest: PagesFunction<Env> = async () =>
  new Response('Method Not Allowed', { status: 405, headers: { allow: 'GET' } });
