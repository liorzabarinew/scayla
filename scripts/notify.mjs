// notify.mjs · Scayla — התראות תפעוליות לטלגרם של ליאור.
// env: TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. בלי שניהם → no-op שקט (לא מפיל ריצה).
// שימוש: import { notify } from './notify.mjs'; await notify('טקסט')  ·  או CLI: node notify.mjs "טקסט"

const TOKEN = process.env.TELEGRAM_BOT_TOKEN
const CHAT = process.env.TELEGRAM_CHAT_ID

export async function notify(text) {
  if (!TOKEN || !CHAT) { console.error('notify: TELEGRAM_* not set, skipping'); return false }
  try {
    const res = await fetch(`https://api.telegram.org/bot${TOKEN}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: CHAT, text, parse_mode: 'HTML', disable_web_page_preview: true }),
    })
    const j = await res.json()
    if (!j.ok) { console.error('notify error:', JSON.stringify(j).slice(0, 200)); return false }
    return true
  } catch (e) { console.error('notify failed:', String(e).slice(0, 160)); return false }
}

// בריחת-HTML · parse_mode:HTML נכשל על < / > / & לא-מוברחים בכותרת/slug/סיבה.
const esc = (s) => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

// מנסח שורת-סיכום ידידותית פר-מאמר מתוך RESULT של המכונה (בשפה רגועה, כמו בנק-קט).
export function articleLine(r) {
  if (!r || !r.status) return ''
  const url = r.url ? ` · <a href="${encodeURI(r.url)}">${esc(r.slug || 'לינק')}</a>` : ''
  switch (r.status) {
    case 'published': return `🎉 עלה: <b>${esc(r.title || r.slug)}</b>${url}`
    case 'banked':    return `🏦 נכתב למאגר (מוחזק לבדיקה · ${esc(r.qa || '')}): <b>${esc(r.title || r.slug)}</b>`
    case 'skipped':   return `🛑 נפסל ב-QA: ${esc(r.reason || r.slug)}`
    case 'error':     return `⚠️ שגיאה (${esc(r.cluster || '')}): ${esc(r.reason || '')}`
    default:          return `• ${esc(r.status)}: ${esc(r.slug || '')}`
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const text = process.argv.slice(2).join(' ') || 'בדיקת חיבור · מכונת התוכן של Scayla'
  const ok = await notify(text)
  console.log(ok ? '✓ sent' : '✗ not sent (check TELEGRAM_* env)')
}
