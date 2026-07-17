/**
 * scayla-scan-machine · שירות Cloud Run.
 * POST /start  {jobId, host, blog}  → 202, והעבודה ממשיכה ברקע
 * GET  /state?job=<id>              → מצב הג'וב מ-Firestore (עקבי-חזק)
 *
 * מוגן ב-shared secret · רק ה-Pages Function שלנו קורא לכאן.
 */
import http from 'node:http';
import { Firestore } from '@google-cloud/firestore';
import { runScan } from './machine.mjs';
import { buildBoth } from './articles.mjs';
import { sendReady } from './email.mjs';

const db = new Firestore({ projectId: process.env.GCP_PROJECT || 'scayla-prod' });
const col = db.collection('scan_jobs');
const SECRET = process.env.MACHINE_SECRET || '';

const save = (id, patch) => col.doc(id).set({ ...patch, updatedAt: Date.now() }, { merge: true });

async function work(jobId, host, blog) {
  try {
    // ריצה אחת רציפה · הסריקה והמאמרים הם אותו מסע, לא שני מוצרים.
    // אין שער מייל באמצע · המייל הוא נוחות שנרשמת תוך כדי.
    await runScan({ host, blog }, (patch) => save(jobId, patch));
    await writeArticles(jobId);
  } catch (e) {
    console.error('scan failed', jobId, e?.message);
    await save(jobId, {
      phase: 'error',
      error: { title: e?.userTitle || 'הבדיקה נכשלה', message: e?.userMessage || 'משהו השתבש אצלנו · נסו שוב בעוד כמה דקות.' },
      _debug: String(e?.message || e).slice(0, 300),
    });
  }
}

/**
 * שני המאמרים · רצים במקביל, ואז מייל עם קישור.
 * המאמרים נשמרים ב-Firestore ומוצגים בעמוד. המייל נושא קישור בלבד.
 */
async function writeArticles(jobId) {
  const snap = await col.doc(jobId).get();
  const job = snap.data();
  if (!job?.score) return;
  await save(jobId, { phase: 'generating', articlesStartedAt: Date.now() });

  const store = { host: job.host, title: job.store?.title || '', description: '', text: '' };
  try {
    // ההתקדמות כותבת ל-gen בלבד · לא ל-articles.
    // קודם שניהם כתבו ל-articles, וה-emit הלא-מסונכרן של הסיום נחת *אחרי*
    // השמירה הסופית ודרס את המאמרים במצב-התקדמות ריק. התוכן אבד בדיסק,
    // לא בצינור. שדות נפרדים = אין מרוץ.
    const articles = await buildBoth(store, job.score, (state) =>
      save(jobId, { gen: { steps: state.map((s) => ({ label: `${s.ord} · ${s.phase}`, state: s.done ? 'done' : 'running' })) } }),
    );
    if (!articles.length) throw new Error('no articles produced');

    await save(jobId, { phase: 'done', articles, finishedAt: Date.now() });

    // מייל · רק אם הליד השאיר אחד תוך כדי הריצה. אחרון בתור, כי אם הוא
    // נופל המאמרים כבר בעמוד ולא אבדו.
    const fresh = (await col.doc(jobId).get()).data();
    if (fresh?.lead?.email) await notify(jobId, fresh);
  } catch (e) {
    console.error('articles failed', jobId, e?.message);
    await save(jobId, {
      phase: 'error',
      error: { title: 'לא הצלחנו לכתוב את המאמרים', message: 'נסו שוב בעוד כמה דקות · הציון שלכם נשמר.' },
      _debug: String(e?.message || e).slice(0, 300),
    });
  }
}

/** שולח את ההתראה · קישור בלבד, לא את המאמרים. */
async function notify(jobId, job) {
  try {
    const id = await sendReady({
      apiKey: process.env.RESEND_API_KEY, to: job.lead.email, name: job.lead.name,
      host: job.host, jobId, pct: job.score?.pct,
    });
    await save(jobId, { emailedAt: Date.now(), emailId: id });
  } catch (e) {
    console.error('email failed', jobId, e?.message);
    await save(jobId, { _emailError: String(e?.message).slice(0, 200) });
  }
}

const json = (res, code, body) => {
  res.writeHead(code, { 'content-type': 'application/json', 'cache-control': 'no-store' });
  res.end(JSON.stringify(body));
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname === '/healthz') return json(res, 200, { ok: true });
    if (SECRET && req.headers['x-machine-secret'] !== SECRET) return json(res, 401, { error: 'unauthorized' });

    if (req.method === 'POST' && url.pathname === '/start') {
      const body = await new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
      const { jobId, host, blog } = JSON.parse(body || '{}');
      if (!jobId || !host) return json(res, 400, { error: 'missing' });
      await save(jobId, { id: jobId, host, blog: blog || '', phase: 'scanning', startedAt: Date.now() });
      // 202 מיד · העבודה ממשיכה. CPU always-allocated, אז היא לא נחנקת.
      json(res, 202, { ok: true, jobId });
      work(jobId, host, blog);
      return;
    }

    // רישום מייל · לא שער. הריצה כבר רצה ממילא.
    if (req.method === 'POST' && url.pathname === '/email') {
      const body = await new Promise((ok) => { let b = ''; req.on('data', (c) => (b += c)); req.on('end', () => ok(b)); });
      const { jobId, name, email } = JSON.parse(body || '{}');
      if (!jobId || !email) return json(res, 400, { error: 'missing' });
      const snap = await col.doc(jobId).get();
      if (!snap.exists) return json(res, 404, { error: 'not_found' });
      await save(jobId, { lead: { name: name || '', email } });
      json(res, 202, { ok: true });
      // כבר מוכן · שולחים מיד במקום לחכות לריצה שכבר הסתיימה
      const j = snap.data();
      if (j?.phase === 'done') notify(jobId, { ...j, lead: { name, email } });
      return;
    }

    if (req.method === 'GET' && url.pathname === '/state') {
      const id = url.searchParams.get('job') || '';
      const doc = await col.doc(id).get();
      if (!doc.exists) return json(res, 404, { error: 'not_found' });
      return json(res, 200, doc.data());
    }
    json(res, 404, { error: 'no_route' });
  } catch (e) {
    console.error('server error', e?.message);
    json(res, 500, { error: 'server' });
  }
}).listen(process.env.PORT || 8080, () => console.log('scan-machine up'));
