/**
 * מייל · Resend. הדומיין scayla.co.il מאומת.
 *
 * המייל הוא התראה, לא המשלוח: הוא נושא קישור לעמוד של הליד ולא את המאמרים
 * עצמם. כל הערך נשאר באתר · זו החלטה של ליאור ואסור לשבור אותה.
 *
 * חוק הברזל (30א): כל מייל נושא זהות שולח + הסרה. גם התראה מבוקשת.
 *
 * RTL: Gmail מפשיט את <html dir="rtl"> ואת <body>, אז היישור חוזר ל-LTR.
 * לכן dir="rtl" + text-align:right יושבים inline על תא ה-card עצמו, לא רק
 * על ה-<html>. מבנה טבלה · Outlook/Gmail/Apple Mail מרנדרים אותו זהה.
 */
const FROM = 'Scayla <hello@scayla.co.il>';
const SITE = 'https://scayla.co.il';
const LOGO = `${SITE}/scayla-icon-512.png`;

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** בונה את גוף המייל · מיוצא בנפרד כדי שאפשר לרנדר ולאמת RTL בלי לשלוח. */
export function readyEmail({ to, name, host, jobId, pct }) {
  const url = `${SITE}/scan/${jobId}`;
  const hi = name ? `${esc(name)}, ` : '';
  const font = 'Heebo,Arial,Helvetica,sans-serif';

  const html = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head>
<body style="margin:0;padding:0;background:#f6f4fb">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0" style="background:#f6f4fb">
  <tr><td align="center" style="padding:28px 16px">
    <table role="presentation" width="520" cellpadding="0" cellspacing="0" border="0" style="width:520px;max-width:520px">
      <tr><td dir="rtl" style="direction:rtl;text-align:right;background:#ffffff;border:1px solid #e8e8ed;border-radius:16px;padding:32px 28px;font-family:${font}">

        <div style="text-align:right;margin:0 0 22px">
          <span style="display:inline-block;direction:ltr;white-space:nowrap">
            <img src="${LOGO}" width="34" height="34" alt="Scayla" style="vertical-align:middle;border:0;border-radius:8px;margin-right:8px">
            <span style="vertical-align:middle;font-size:19px;font-weight:800;color:#5546d6;font-family:${font}">Scayla</span>
          </span>
        </div>

        <h1 style="direction:rtl;text-align:right;font-size:22px;font-weight:800;color:#1d1d1f;margin:0 0 12px;line-height:1.35;font-family:${font}">${hi}שני המאמרים שלכם מוכנים</h1>

        <p style="direction:rtl;text-align:right;font-size:15px;line-height:1.75;color:#4b4b55;margin:0 0 8px;font-family:${font}">
          סיימנו לכתוב את שני המאמרים ל־<strong style="color:#1d1d1f">${esc(host)}</strong>, על הנושאים שבהם לא הופעתם בתשובות ה־AI.
        </p>
        <p style="direction:rtl;text-align:right;font-size:15px;line-height:1.75;color:#4b4b55;margin:0 0 26px;font-family:${font}">
          הם מחכים לכם בעמוד שלכם, יחד עם הציון שקיבלתם${pct != null ? ` (<strong style="color:#1d1d1f">${pct}%</strong>)` : ''}.
        </p>

        <div style="text-align:right;margin:0 0 22px">
          <a href="${url}" style="display:inline-block;background:#24c88c;color:#052b1d;font-size:16px;font-weight:800;text-decoration:none;padding:14px 30px;border-radius:999px;font-family:${font}">לצפייה במאמרים</a>
        </div>

        <p dir="ltr" style="direction:ltr;text-align:right;font-size:13px;color:#8a8a90;margin:0;word-break:break-all;font-family:${font}">${url}</p>

        <hr style="border:none;border-top:1px solid #f0f0f3;margin:26px 0 16px">

        <p style="direction:rtl;text-align:right;font-size:12px;line-height:1.7;color:#8a8a90;margin:0;font-family:${font}">
          נשלח על ידי <strong style="color:#6e6e73">ליאור צברי בע"מ</strong> · ח.פ. 516967395 · scayla.co.il<br>
          קיבלתם את המייל הזה כי ביקשתם שנכתוב לכם מאמרים בעמוד הבדיקה שלנו.<br>
          <a href="${SITE}/scan?unsub=${encodeURIComponent(to)}" style="color:#8a8a90">להסרה מרשימת הדיוור</a>
        </p>

      </td></tr>
    </table>
  </td></tr>
</table>
</body></html>`;

  const text = `${name ? name + ', ' : ''}שני המאמרים שלכם ל-${host} מוכנים ומחכים בעמוד שלכם:\n${url}\n\nנשלח על ידי ליאור צברי בע"מ · ח.פ. 516967395 · scayla.co.il\nלהסרה: ${SITE}/scan?unsub=${encodeURIComponent(to)}`;

  return { html, text, url };
}

export async function sendReady({ apiKey, to, name, host, jobId, pct }) {
  if (!apiKey) throw new Error('RESEND_API_KEY missing');
  const { html, text } = readyEmail({ to, name, host, jobId, pct });

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: [to],
      subject: `${name ? name + ', ' : ''}שני המאמרים שלכם מוכנים · ${host}`,
      html, text,
      headers: { 'List-Unsubscribe': `<${SITE}/scan?unsub=${encodeURIComponent(to)}>` },
    }),
  });
  if (!r.ok) throw new Error(`resend ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return (await r.json()).id;
}

/**
 * דיווח פנימי לבעלים (ליאור) · על כל סריקה, כדי לראות תוצאות ומי משתמש.
 * זה מייל *נפרד* לגמרי · לא CC/BCC על המייל של המשתמש, אז הוא לעולם לא רואה
 * שליאור מכותב. fire-and-forget · אסור שייכשל וישבור את הריצה של המכונה.
 */
const OWNER_EMAIL = 'liorz1988@gmail.com';
export async function sendOwnerNotice({ apiKey, host, jobId, job }) {
  if (!apiKey || !job) return null;
  const url = `${SITE}/scan/${jobId}`;
  const pct = job.score?.pct;
  const hit = job.score?.queriesMentioned ?? job.score?.hit;
  const total = job.score?.total ?? 16;
  const done = job.phase === 'done';
  const lead = job.lead;
  const font = 'Heebo,Arial,Helvetica,sans-serif';
  const status = done
    ? `הושלמה · ציון ${pct}%${hit != null ? ` (${hit}/${total})` : ''}`
    : (job.phase === 'error' ? `נכשלה · ${esc(job.error?.title || 'שגיאה')}` : `בתהליך · ${esc(job.phase || '')}`);
  const leadLine = lead?.email
    ? `<strong style="color:#1d1d1f">${esc(lead.name || '')} ${esc(lead.email)}</strong>`
    : '<span style="color:#8a8a90">לא השאיר מייל</span>';
  // שכבת SERP פנימית (אם רצה) · נראות בגוגל + מתחרים אמיתיים.
  const serp = job.score?.serp;
  const serpRow = serp
    ? `<tr><td style="padding:5px 0;color:#8a8a90">גוגל</td><td style="padding:5px 0">מופיע ב-${serp.storePresent}/${serp.asked} שאלות · מתחרים: ${(serp.competitors || []).slice(0, 4).map((c) => esc(c.domain)).join(' · ') || '—'}</td></tr>`
    : '';

  const html = `<!doctype html><html dir="rtl" lang="he"><head><meta charset="utf-8"></head>
<body style="margin:0;background:#f6f4fb;padding:24px 16px;font-family:${font}">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" border="0"><tr><td align="center">
<table role="presentation" width="540" cellpadding="0" cellspacing="0" border="0" style="width:540px;max-width:540px">
<tr><td dir="rtl" style="direction:rtl;text-align:right;background:#fff;border:1px solid #e8e8ed;border-radius:14px;padding:26px 24px;font-family:${font}">
  <div style="font-size:13px;font-weight:800;color:#5546d6;margin-bottom:6px">Scayla · דיווח פנימי</div>
  <h1 style="direction:rtl;text-align:right;font-size:20px;font-weight:800;color:#1d1d1f;margin:0 0 16px">🔔 סריקה חדשה · ${esc(host)}</h1>
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="font-size:14.5px;color:#4b4b55">
    <tr><td style="padding:5px 0;width:90px;color:#8a8a90">חנות</td><td style="padding:5px 0"><strong style="color:#1d1d1f">${esc(host)}</strong>${job.blog ? ` · בלוג: ${esc(job.blog)}` : ''}</td></tr>
    <tr><td style="padding:5px 0;color:#8a8a90">סטטוס</td><td style="padding:5px 0">${status}</td></tr>
    <tr><td style="padding:5px 0;color:#8a8a90">מי</td><td style="padding:5px 0">${leadLine}</td></tr>
    ${serpRow}
  </table>
  <a href="${url}" style="display:inline-block;margin-top:18px;background:#5546d6;color:#fff;font-size:15px;font-weight:800;text-decoration:none;padding:12px 26px;border-radius:999px">לצפייה בתוצאה ובמאמרים</a>
  <p dir="ltr" style="direction:ltr;text-align:right;font-size:12px;color:#a7a7ae;margin:16px 0 0;word-break:break-all">${url}</p>
</td></tr></table></td></tr></table></body></html>`;

  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({
      from: FROM, to: [OWNER_EMAIL],
      subject: `🔔 סריקה: ${host} · ${done ? `${pct}%` : (job.phase === 'error' ? 'נכשלה' : job.phase)}`,
      html,
    }),
  });
  if (!r.ok) throw new Error(`resend owner ${r.status}: ${(await r.text()).slice(0, 160)}`);
  return (await r.json()).id;
}
