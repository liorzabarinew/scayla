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

const db = new Firestore({ projectId: process.env.GCP_PROJECT || 'scayla-prod' });
const col = db.collection('scan_jobs');
const SECRET = process.env.MACHINE_SECRET || '';

const save = (id, patch) => col.doc(id).set({ ...patch, updatedAt: Date.now() }, { merge: true });

async function work(jobId, host, blog) {
  try {
    await runScan({ host, blog }, (patch) => save(jobId, patch));
  } catch (e) {
    console.error('scan failed', jobId, e?.message);
    await save(jobId, {
      phase: 'error',
      error: { title: e?.userTitle || 'הבדיקה נכשלה', message: e?.userMessage || 'משהו השתבש אצלנו · נסו שוב בעוד כמה דקות.' },
      _debug: String(e?.message || e).slice(0, 300),
    });
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
