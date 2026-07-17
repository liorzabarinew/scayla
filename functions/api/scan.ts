/**
 * POST /api/scan · פותח ג'וב סריקה ומחזיר jobId מיד.
 *
 * הסריקה עצמה רצה ב-waitUntil ומעדכנת את ה-KV שלב אחרי שלב, כך שה-status
 * מחזיר לוג חי. אם שלב נכשל · הג'וב עובר ל-error. אין נפילה לנתוני דמו.
 */
import {
  type Env, cleanHost, okHost, scanStore, countProducts, buyerQuestions, callGemini,
  detect, brandNamesFrom, bandOf, verifyTurnstile, getJob, putJob, newId, trim,
  domKey, capKey, STEP,
} from './_scan-lib';

const QUESTIONS = 8;
const DEFAULT_CAP = 40;

const save = (env: Env, id: string, job: any) => putJob(env, id, { ...job, updatedAt: Date.now() });

async function runScan(env: Env, id: string, host: string, blog: string) {
  const job: any = await getJob(env, id);
  if (!job) return;

  const steps = [
    STEP(`קוראים את החנות`, 'running'),
    STEP(blog ? 'סורקים את הבלוג' : 'סורקים את הבלוג', blog ? 'pending' : 'skipped'),
    STEP('מרכיבים שאלות קונה מהחנות שלכם', 'pending'),
    STEP('שואלים את Gemini', 'pending'),
    STEP('בודקים מי מופיע בתשובות', 'pending'),
  ];
  job.scan = { steps };
  await save(env, id, job);

  try {
    // ── 1. החנות ──
    const store = await scanStore(host);
    if (!store.ok) {
      job.phase = 'error';
      job.error = { title: 'לא הצלחנו להגיע לחנות', message: 'בדקו שהכתובת נכונה ושהאתר עלה, ונסו שוב.' };
      return save(env, id, job);
    }
    if (store.isShopify) store.productCount = await countProducts(host);
    steps[0] = STEP(
      store.productCount ? `קראנו את החנות · ${store.productCount} מוצרים` : 'קראנו את החנות',
      'done',
    );
    job.store = { host, title: store.title, isShopify: store.isShopify, products: store.productCount };
    await save(env, id, job);

    // ── 2. הבלוג · אופציונלי, best-effort ──
    if (blog) {
      steps[1] = STEP('סורקים את הבלוג', 'running');
      await save(env, id, job);
      const b = await scanStore(cleanHost(blog));
      steps[1] = STEP(b.ok ? 'קראנו את הבלוג' : 'הבלוג לא נענה · ממשיכים בלעדיו', b.ok ? 'done' : 'skipped');
      if (b.ok) store.text = (store.text + ' ' + b.text).slice(0, 8000);
      await save(env, id, job);
    }

    // ── 3. שאלות קונה ──
    steps[2] = STEP('מרכיבים שאלות קונה מהחנות שלכם', 'running');
    await save(env, id, job);
    const qs = await buyerQuestions(env, store, QUESTIONS);
    steps[2] = STEP(`הרכבנו ${qs.length} שאלות קונה מהחנות שלכם`, 'done');
    await save(env, id, job);

    // ── 4. Gemini · שאלה־שאלה, עם עיגון בחיפוש ──
    steps[3] = STEP(`שואלים את Gemini · 0/${qs.length}`, 'running');
    await save(env, id, job);

    const brands = brandNamesFrom(store);
    const answers: any[] = [];
    let hit = 0;
    for (let i = 0; i < qs.length; i++) {
      let a;
      try {
        a = await callGemini(env, qs[i], { grounded: true, maxTokens: 2000, timeoutMs: 40_000 });
      } catch {
        continue; // שאלה שנפלה לא נספרת בכלל · לא במונה ולא במכנה
      }
      const d = detect(a, host, brands);
      if (d.mentioned) hit++;
      answers.push({
        q: qs[i],
        engine: 'gemini',
        text: a.text.slice(0, 700),
        mentioned: d.mentioned,
        sources: a.sources.slice(0, 4),
      });
      steps[3] = STEP(`שואלים את Gemini · ${i + 1}/${qs.length}`, 'running');
      await save(env, id, job);
    }

    if (!answers.length) {
      job.phase = 'error';
      job.error = { title: 'הבדיקה לא הושלמה', message: 'לא הצלחנו לקבל תשובות כרגע · נסו שוב בעוד כמה דקות.' };
      return save(env, id, job);
    }

    steps[3] = STEP(`שאלנו את Gemini · ${answers.length} שאלות`, 'done');
    steps[4] = STEP('בודקים מי מופיע בתשובות', 'running');
    await save(env, id, job);

    // ── 5. הציון · אותה נוסחה של המוצר: אחוז השאלות שבהן הופענו ──
    const pct = Math.round((100 * hit) / answers.length);
    steps[4] = STEP(`הופעתם ב-${hit} מתוך ${answers.length} תשובות`, 'done');
    job.phase = 'score';
    job.score = {
      pct,
      band: bandOf(pct),
      queriesAsked: answers.length,
      queriesMentioned: hit,
      engines: ['gemini'],
      answers,
    };
    await save(env, id, job);
  } catch (e: any) {
    job.phase = 'error';
    job.error = { title: 'הבדיקה נכשלה', message: 'משהו השתבש אצלנו · נסו שוב בעוד כמה דקות.' };
    console.error('scan failed', id, e?.message);
    // משחררים את הדומיין · אחרת כישלון אצלנו נועל את הליד לשבוע
    await env.SCAN_JOBS?.delete(domKey(host)).catch(() => {});
    await save(env, id, job);
  }
}

export const onRequestPost: PagesFunction<Env> = async (ctx) => {
  const { request, env } = ctx;
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

  if (!env.SCAN_JOBS) return Response.json({ error: 'not_configured' }, { status: 503 });

  // סריקה אחת לדומיין · מחזירים את הקיימת ולא מחייבים פעמיים.
  // ג'וב שנכשל לא נחשב · אחרת ליד שהסריקה שלו קרסה היה נחסם שבוע שלם
  // ולא היה יכול לנסות שוב לעולם. נכשל = מנקים ורצים מחדש.
  const seen = await env.SCAN_JOBS.get(domKey(host));
  if (seen) {
    const j = await getJob(env, seen);
    if (j && j.phase !== 'error') {
      return Response.json({ jobId: seen, phase: j.phase, scan: j.scan, reused: true });
    }
    await env.SCAN_JOBS.delete(domKey(host));
  }

  // תקרה יומית
  const cap = Number(env.SCAN_DAILY_CAP || DEFAULT_CAP);
  const used = Number((await env.SCAN_JOBS.get(capKey())) || 0);
  if (used >= cap) return Response.json({ error: 'scan_cap' }, { status: 503 });
  await env.SCAN_JOBS.put(capKey(), String(used + 1), { expirationTtl: 60 * 60 * 36 });

  const id = newId();
  const job = {
    id, host, blog, phase: 'scanning', startedAt: Date.now(),
    scan: { steps: [STEP('קוראים את החנות', 'running')] },
  };
  await putJob(env, id, job);
  await env.SCAN_JOBS.put(domKey(host), id, { expirationTtl: 60 * 60 * 24 * 7 });

  ctx.waitUntil(runScan(env, id, host, blog));
  return Response.json({ jobId: id, phase: 'scanning', scan: job.scan });
};

export const onRequest: PagesFunction<Env> = async () =>
  new Response('Method Not Allowed', { status: 405, headers: { allow: 'POST' } });
