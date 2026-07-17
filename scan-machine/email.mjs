/**
 * מייל · Resend. הדומיין scayla.co.il מאומת.
 *
 * המייל הוא התראה, לא המשלוח: הוא נושא קישור לעמוד של הליד ולא את המאמרים
 * עצמם. כל הערך נשאר באתר · זו החלטה של ליאור ואסור לשבור אותה.
 *
 * חוק הברזל (30א): כל מייל נושא זהות שולח + הסרה. גם התראה מבוקשת.
 */
const FROM = 'Scayla <hello@scayla.co.il>';
const SITE = 'https://scayla.co.il';

const esc = (s) => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export async function sendReady({ apiKey, to, name, host, jobId, pct }) {
  if (!apiKey) throw new Error('RESEND_API_KEY missing');
  const url = `${SITE}/scan/${jobId}`;
  const hi = name ? `${esc(name)}, ` : '';

  const html = `<!doctype html><html dir="rtl" lang="he"><body style="margin:0;background:#f6f4fb;padding:28px 16px;font-family:Heebo,Arial,sans-serif">
<div style="max-width:520px;margin:0 auto;background:#fff;border:1px solid #e8e8ed;border-radius:16px;padding:32px 28px">
  <div style="font-size:19px;font-weight:800;color:#211c86;margin-bottom:22px">Scayla</div>
  <h1 style="font-size:22px;font-weight:800;color:#1d1d1f;margin:0 0 12px;line-height:1.35">${hi}שני המאמרים שלכם מוכנים</h1>
  <p style="font-size:15px;line-height:1.75;color:#4b4b55;margin:0 0 8px">
    סיימנו לכתוב את שני המאמרים ל־<strong style="color:#1d1d1f">${esc(host)}</strong>, על הנושאים שבהם לא הופעתם בתשובות ה־AI.
  </p>
  <p style="font-size:15px;line-height:1.75;color:#4b4b55;margin:0 0 26px">
    הם מחכים לכם בעמוד שלכם, יחד עם הציון שקיבלתם${pct != null ? ` (<strong style="color:#1d1d1f">${pct}%</strong>)` : ''}.
  </p>
  <a href="${url}" style="display:inline-block;background:#24c88c;color:#052b1d;font-size:16px;font-weight:800;text-decoration:none;padding:14px 30px;border-radius:999px">לצפייה במאמרים</a>
  <p style="font-size:13px;color:#8a8a90;margin:22px 0 0;word-break:break-all">${url}</p>
  <hr style="border:none;border-top:1px solid #f0f0f3;margin:26px 0 16px">
  <p style="font-size:12px;line-height:1.7;color:#8a8a90;margin:0">
    נשלח על ידי <strong style="color:#6e6e73">ליאור צברי בע"מ</strong> · ח.פ. 516967395 · scayla.co.il<br>
    קיבלתם את המייל הזה כי ביקשתם שנכתוב לכם מאמרים בעמוד הבדיקה שלנו.<br>
    <a href="${SITE}/scan?unsub=${encodeURIComponent(to)}" style="color:#8a8a90">להסרה מרשימת הדיוור</a>
  </p>
</div></body></html>`;

  const text = `${name ? name + ', ' : ''}שני המאמרים שלכם ל-${host} מוכרים ומחכים בעמוד שלכם:\n${url}\n\nנשלח על ידי ליאור צברי בע"מ · ח.פ. 516967395 · scayla.co.il\nלהסרה: ${SITE}/scan?unsub=${encodeURIComponent(to)}`;

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
