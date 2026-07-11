// functions/api/contact.js · Cloudflare Pages Function → POST /api/contact
// Receives the contact form (JSON from fetch, or form-encoded no-JS fallback),
// validates, blocks bots via a honeypot, and emails lior@mrmake.co.il via FormSubmit.
//
// No API key / secret required. The FIRST submission triggers a one-time activation
// email to lior@mrmake.co.il — click the link once, and every later message is
// delivered automatically. To switch to a first-party sender (Resend) later, replace
// only the fetch() below.

const TO = 'lior@mrmake.co.il';

const json = (obj, status = 200) =>
  new Response(JSON.stringify(obj), {
    status,
    headers: { 'content-type': 'application/json; charset=utf-8' },
  });

export async function onRequestPost({ request }) {
  let data = {};
  const ct = request.headers.get('content-type') || '';
  try {
    if (ct.includes('application/json')) data = await request.json();
    else data = Object.fromEntries(await request.formData());
  } catch {
    return json({ ok: false, error: 'קלט לא תקין' }, 400);
  }

  // Honeypot: real users never see the "company" field; bots fill it. Silently accept.
  if ((data.company || '').toString().trim()) return json({ ok: true });

  const name = (data.name || '').toString().trim();
  const email = (data.email || '').toString().trim();
  const store = (data.store || '').toString().trim();
  const message = (data.message || '').toString().trim();

  if (!name || !email || !message) return json({ ok: false, error: 'נא למלא שם, אימייל והודעה' }, 400);
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json({ ok: false, error: 'כתובת אימייל לא תקינה' }, 400);
  if (name.length > 120 || email.length > 200 || message.length > 5000) {
    return json({ ok: false, error: 'הטקסט ארוך מדי' }, 400);
  }

  try {
    const res = await fetch('https://formsubmit.co/ajax/' + encodeURIComponent(TO), {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        accept: 'application/json',
        // FormSubmit rejects bare server calls — it wants a real web origin.
        origin: 'https://scayla.co.il',
        referer: 'https://scayla.co.il/contact',
      },
      body: JSON.stringify({
        name,
        email, // FormSubmit uses this as the Reply-To, so Lior can reply directly
        store: store || '(לא צויין)',
        message,
        _subject: `Scayla · פנייה חדשה מ־${name}`,
        _template: 'table',
        _captcha: 'false',
      }),
    });
    const out = await res.json().catch(() => ({}));
    // success:"true" = delivered · message with "Activation" = pending Lior's one-time
    // click (form still records it once activated). Anything else = a real failure.
    const ok = out.success === 'true' || out.success === true || /activation/i.test(out.message || '');
    if (!ok) return json({ ok: false, error: 'שליחת המייל נכשלה, נסו שוב' }, 502);
    return json({ ok: true });
  } catch {
    return json({ ok: false, error: 'שגיאת שרת בשליחה' }, 502);
  }
}

// Hitting /api/contact in a browser (GET) shouldn't 404.
export const onRequestGet = () =>
  new Response('Scayla contact endpoint · POST only', {
    headers: { 'content-type': 'text/plain; charset=utf-8' },
  });
