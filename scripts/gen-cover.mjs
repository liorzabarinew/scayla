// ─────────────────────────────────────────────────────────────────────────────
// gen-cover.mjs · Scayla — תמונת-שער (hero) למאמר, בסגנון-בית "כיוון 3" (אבסטרקט
// גרדיאנט כהה). דרך Gemini native image gen (gemini-2.5-flash-image) על Vertex,
// כי Imagen לא זמין בפרויקט. art-director קליל (gemini-2.5-flash) קורא את הכותרת
// וממציא motif אבסטרקטי (בלי אובייקטים ליטרליים) → אינסוף וריאציות, אותו סטייל.
//
// פלט: public/covers/<slug>.webp  (1600x760, hero רחב · כהה · מקום-טקסט מימין).
// CLI:  GOOGLE_SA=... GCP_PROJECT=scayla-prod node scripts/gen-cover.mjs "<slug>" "<title>"
// API:  import { generateCover } from './gen-cover.mjs'
// ─────────────────────────────────────────────────────────────────────────────
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import sharp from 'sharp'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const COVERS_DIR = path.join(ROOT, 'public', 'covers')
const REGION = process.env.GCP_REGION || 'us-central1'
const IMG_MODEL = 'gemini-2.5-flash-image'
const ART_MODEL = 'gemini-2.5-flash'

function readSA() {
  if (process.env.GOOGLE_SA) return JSON.parse(process.env.GOOGLE_SA)
  return JSON.parse(fs.readFileSync(path.join(ROOT, '.secrets', 'sa.json'), 'utf8'))
}
const SA = readSA()
const PROJECT = process.env.GCP_PROJECT || SA.project_id
let _tok = null, _exp = 0
async function token() {
  const now = Math.floor(Date.now() / 1000)
  if (_tok && now < _exp - 60) return _tok
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const c = Buffer.from(JSON.stringify({ iss: SA.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })).toString('base64url')
  const u = h + '.' + c
  const sig = crypto.sign('RSA-SHA256', Buffer.from(u), SA.private_key).toString('base64url')
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: u + '.' + sig }) })
  const j = await r.json()
  if (!j.access_token) throw new Error('token: ' + JSON.stringify(j).slice(0, 200))
  _tok = j.access_token; _exp = now + (j.expires_in || 3600); return _tok
}

// motif אבסטרקטי fallback (בלי art-director / כשל) — כולם בשפת כיוון-3.
const FALLBACK_MOTIFS = [
  'a smooth glowing curve rising from the lower-left toward a single bright gold node, soft scattered light dots',
  'concentric broadcast rings expanding from a glowing gold node on the left, faint network dots',
  'a branching constellation of thin glowing lines converging to one bright gold point, upper-left',
  'an ascending staircase of translucent violet rounded rectangles with a gold spark at the top-left',
]
const hashStr = (s) => { let h = 0; for (const ch of String(s)) h = (h * 31 + ch.charCodeAt(0)) | 0; return Math.abs(h) }

async function artDirect(title) {
  try {
    const prompt = `For a Hebrew magazine article about SEO/GEO for online stores titled "${title}", invent ONE abstract, text-free visual MOTIF for a dark premium gradient cover, 8-16 words. NO literal objects (no shop, no cart, no phone, no charts, no text). Only abstract growth/signal/network metaphors: a rising glowing curve, expanding rings, a converging constellation of lines, an ascending stack of translucent shapes, a single bright node. Return ONLY JSON: {"motif":"..."}`
    const url = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/publishers/google/models/${ART_MODEL}:generateContent`
    const r = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + (await token()), 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { temperature: 0.95, maxOutputTokens: 256, responseMimeType: 'application/json', thinkingConfig: { thinkingBudget: 0 } } }) })
    const j = await r.json()
    const txt = j.candidates?.[0]?.content?.parts?.map((p) => p.text).join('') || ''
    const m = txt.match(/\{[\s\S]*\}/)
    if (m) { const o = JSON.parse(m[0]); if (o.motif && o.motif.split(/\s+/).length >= 4) return o.motif }
  } catch { /* fallback */ }
  return FALLBACK_MOTIFS[hashStr(title) % FALLBACK_MOTIFS.length]
}

const buildPrompt = (motif) => `Abstract modern geometric composition for a premium magazine article hero banner, drawn digital art (NOT a photo, NOT 3D). RICH DEEP DARK background: deep indigo #211c86 and royal violet #5546d6 gradient, dark and saturated. On the LEFT third: ${motif}, rendered in violet with a warm-gold accent glow and translucent glossy rounded-rectangle shapes. The RIGHT two-thirds is calm deep-indigo gradient with generous negative space. Elegant, techy, premium, cinematic soft glow. Absolutely NO text, no words, no letters, no numbers, no logos, no UI, no human faces, no photorealism. Wide 16:9 horizontal banner composition.`

async function imagen(prompt) {
  const url = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/publishers/google/models/${IMG_MODEL}:generateContent`
  const r = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + (await token()), 'content-type': 'application/json' }, body: JSON.stringify({ contents: [{ role: 'user', parts: [{ text: prompt }] }], generationConfig: { responseModalities: ['IMAGE'] } }) })
  const j = await r.json()
  if (j.error) throw new Error('image ' + (j.error.code || '') + ': ' + (j.error.message || '').slice(0, 160))
  const img = (j.candidates?.[0]?.content?.parts || []).find((p) => p.inlineData?.data)
  if (!img) throw new Error('image: no image (' + JSON.stringify(j).slice(0, 160) + ')')
  return Buffer.from(img.inlineData.data, 'base64')
}

/** מייצר hero-cover ושומר public/covers/<slug>.webp. מחזיר '/covers/<slug>.webp' או null בכשל. */
export async function generateCover({ slug, title }) {
  try {
    const motif = await artDirect(title)
    const png = await imagen(buildPrompt(motif))
    fs.mkdirSync(COVERS_DIR, { recursive: true })
    const outAbs = path.join(COVERS_DIR, `${slug}.webp`)
    await sharp(png).resize(1600, 760, { fit: 'cover', position: 'left' }).webp({ quality: 86 }).toFile(outAbs)
    return `/covers/${slug}.webp`
  } catch (e) {
    console.error('  ✗ cover skipped:', String(e).slice(0, 140))
    return null
  }
}

// CLI
if (import.meta.url === `file://${process.argv[1]}`) {
  const slug = process.argv[2], title = process.argv[3] || slug
  if (!slug) { console.error('usage: gen-cover.mjs "<slug>" "<title>"'); process.exit(1) }
  const p = await generateCover({ slug, title })
  console.log(p ? `✓ ${p}` : '✗ failed')
}
