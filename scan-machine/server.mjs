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
import { sendReady, sendOwnerNotice } from './email.mjs';

const db = new Firestore({ projectId: process.env.GCP_PROJECT || 'scayla-prod' });
const col = db.collection('scan_jobs');
const domains = db.collection('scan_domains');
const SECRET = process.env.MACHINE_SECRET || '';

const save = (id, patch) => col.doc(id).set({ ...patch, updatedAt: Date.now() }, { merge: true });

// נעילת דומיין · פעם אחת חינם לכל דומיין-רושם. ריצה פעילה שעברו עליה
// יותר מ-DOM_ACTIVE_MS נחשבת קרוסה · הדומיין משתחרר לניסיון חוזר.
const DOM_ACTIVE_MS = 20 * 60 * 1000;
const DOM_EXPIRE_MS = 400 * 24 * 60 * 60 * 1000;
const MULTI_TLD = new Set([
  'co.il', 'org.il', 'ac.il', 'gov.il', 'net.il', 'muni.il', 'idf.il',
  'co.uk', 'org.uk', 'com.au', 'net.au', 'co.nz', 'co.za', 'com.br', 'co.jp', 'com.tr',
]);
const registrableDomain = (v) => {
  const h = String(v || '').trim().toLowerCase()
    .replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/.*$/, '').replace(/:\d+$/, '');
  const p = h.split('.');
  if (p.length <= 2) return h;
  const last2 = p.slice(-2).join('.');
  return (MULTI_TLD.has(last2) ? p.slice(-3) : p.slice(-2)).join('.');
};
// מזהה-מסמך בטוח ל-Firestore · בלי '/' ובלי נקודות בקצוות.
const domDoc = (dom) => domains.doc(dom.replace(/[^a-z0-9.-]/g, '_'));

async function work(jobId, host, blog, dom) {
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
  // סוגר את נעילת הדומיין לפי התוצאה האמיתית · writeArticles תופס את
  // שגיאתו פנימית ולא זורק, אז בודקים את ה-phase הסופי ולא את ה-try.
  if (dom) {
    try {
      const j = (await col.doc(jobId).get()).data();
      if (j?.phase === 'done') {
        await domDoc(dom).set({ status: 'done', jobId, host, at: Date.now(), expireAt: new Date(Date.now() + DOM_EXPIRE_MS) }, { merge: true });
      } else {
        // הסריקה או המאמרים נכשלו · משחררים את הדומיין לניסיון חוזר.
        await domDoc(dom).delete();
      }
    } catch (err) { console.error('dom finalize', dom, err?.message); }
  }

  // דיווח פנימי לליאור · כל סריקה (הצליחה או נכשלה), כדי לראות תוצאות ומי
  // משתמש. מייל נפרד לגמרי · המשתמש לא רואה אותו. fire-and-forget · עטוף
  // ב-try/catch ולעולם לא זורק, כדי שלא ישבור את המכונה.
  try {
    const fresh = (await col.doc(jobId).get()).data();
    await sendOwnerNotice({ apiKey: process.env.RESEND_API_KEY, host, jobId, job: fresh });
  } catch (err) { console.error('owner notice failed', jobId, err?.message); }
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

      // נעילת דומיין אטומית · הבוררת האמיתית נגד 8-במקביל. טרנזקציית
      // Firestore (עקבית-חזק) מבטיחה שמתוך N בקשות בו-זמנית בדיוק אחת
      // תופסת · השאר מקבלות את הג'וב הקיים. פעם אחת חינם לכל דומיין-רושם.
      const dom = registrableDomain(host);
      let reuse = null;
      try {
        await db.runTransaction(async (tx) => {
          const ref = domDoc(dom);
          const snap = await tx.get(ref);
          if (snap.exists) {
            const d = snap.data();
            const activeRecent = d.status === 'active' && Date.now() - (d.at || 0) < DOM_ACTIVE_MS;
            if (d.status === 'done' || activeRecent) { reuse = d.jobId; return; }
          }
          tx.set(ref, { jobId, status: 'active', host, at: Date.now(), expireAt: new Date(Date.now() + DOM_EXPIRE_MS) });
        });
      } catch (e) {
        // כשל טרנזקציה נדיר · נכשלים פתוח (התקרות ב-Function עדיין חוסמות).
        console.error('dom lock tx', dom, e?.message);
      }
      if (reuse) {
        const rj = (await col.doc(reuse).get()).data();
        return json(res, 200, { ok: true, jobId: reuse, reused: true, phase: rj?.phase || 'scanning' });
      }

      // expireAt · מדיניות ה-TTL של Firestore מוחקת את הג'וב אוטומטית.
      // 30 יום · הקישור /scan/<id> שהלקוח משתף חי חודש, ואז מתנקה לבד.
      const expireAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
      await save(jobId, { id: jobId, host, blog: blog || '', phase: 'scanning', startedAt: Date.now(), expireAt });
      // 202 מיד · העבודה ממשיכה. CPU always-allocated, אז היא לא נחנקת.
      json(res, 202, { ok: true, jobId });
      work(jobId, host, blog, dom);
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
