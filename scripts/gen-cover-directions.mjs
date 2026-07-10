// מייצר 4 כיווני-קאבר (סגנונות ויזואליים שונים) ל-Scayla, דרך Imagen 4 על Vertex.
// כולם בפלטת המותג (אינדיגו-סגול #5546d6 + לבנדר #8b76f2), נושאי SEO/GEO לשופיפיי.
// פלט: public/covers/_sketch/dir-{1..4}.png  (1600x900, 16:9)
import crypto from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const HERE = path.dirname(fileURLToPath(import.meta.url))
const ROOT = path.resolve(HERE, '..')
const OUT = path.join(ROOT, 'public', 'covers', '_sketch')
const REGION = 'us-central1'
const IMAGE_MODEL = 'gemini-2.5-flash-image' // Gemini native image gen (Imagen not enabled on this project)
const SA = JSON.parse(process.env.GOOGLE_SA)
const PROJECT = process.env.GCP_PROJECT || SA.project_id

async function token() {
  const now = Math.floor(Date.now() / 1000)
  const h = Buffer.from(JSON.stringify({ alg: 'RS256', typ: 'JWT' })).toString('base64url')
  const c = Buffer.from(JSON.stringify({ iss: SA.client_email, scope: 'https://www.googleapis.com/auth/cloud-platform', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3600 })).toString('base64url')
  const u = h + '.' + c
  const sig = crypto.sign('RSA-SHA256', Buffer.from(u), SA.private_key).toString('base64url')
  const r = await fetch('https://oauth2.googleapis.com/token', { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion: u + '.' + sig }) })
  const j = await r.json()
  if (!j.access_token) throw new Error('token: ' + JSON.stringify(j).slice(0, 200))
  return j.access_token
}

const NOTEXT = 'Absolutely NO text, no words, no letters, no numbers, no captions, no logos, no UI, no buttons, no website screenshot, no human faces, no photorealism. One clear centered concept, generous calm negative space, wide 16:9 horizontal composition, premium and modern.'
const PAL = 'The palette is built around deep indigo-violet #5546d6 and soft lavender #8b76f2, with a small warm gold accent, set on a very soft lavender-white background.'

// 4 כיוונים · סגנון שונה, כולם מותג-סגול, נושא SEO/GEO
const DIRECTIONS = [
  { id: 1, name: 'Flat vector editorial',
    prompt: `Flat vector editorial spot illustration for a modern SEO/marketing magazine, clean drawn vector art (NOT a photo, NOT 3D). Subject: a small storefront shape rising to the top of an ascending podium of soft rounded blocks, a gentle upward arrow and a few floating magnifier and speech-bubble shapes around it. Sophisticated, grown-up, geometric with soft rounded shapes and subtle shadows. ${PAL} ${NOTEXT}` },
  { id: 2, name: 'Soft 3D clay',
    prompt: `Soft 3D render illustration, premium product-design style, matte clay-like materials, gentle soft studio lighting, smooth rounded forms. Subject: a soft 3D shopping bag glowing at the center of concentric broadcast rings, small floating rounded chat-bubble and magnifier icons orbiting it. Tasteful, sophisticated, modern. ${PAL} ${NOTEXT}` },
  { id: 3, name: 'Abstract gradient geometric',
    prompt: `Abstract modern geometric composition, smooth gradient shapes, glossy glass-morphism style, drawn digital art (NOT a photo). Subject: overlapping translucent rounded rectangles and a rising smooth curve that peaks at a single glowing node, soft floating dots suggesting a network. Elegant, techy, premium, plenty of negative space. ${PAL} ${NOTEXT}` },
  { id: 4, name: 'Isometric line-art tech',
    prompt: `Isometric thin-line illustration, clean modern tech style, drawn vector line art with subtle flat fills (NOT a photo, NOT 3D render). Subject: a small isometric shop connected by glowing thin lines to floating rounded answer-bubbles and a search magnifier, like a store being discovered by AI answer engines. Minimal, precise, sophisticated. ${PAL} ${NOTEXT}` },
]

async function imagen(prompt, tok) {
  const url = `https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/publishers/google/models/${IMAGE_MODEL}:generateContent`
  const body = {
    contents: [{ role: 'user', parts: [{ text: prompt + ' Wide 16:9 horizontal aspect ratio.' }] }],
    generationConfig: { responseModalities: ['IMAGE'] },
  }
  const r = await fetch(url, { method: 'POST', headers: { authorization: 'Bearer ' + tok, 'content-type': 'application/json' }, body: JSON.stringify(body) })
  const j = await r.json()
  if (j.error) throw new Error('image ' + (j.error.code || '') + ': ' + (j.error.message || '').slice(0, 200))
  const parts = j.candidates?.[0]?.content?.parts || []
  const img = parts.find((p) => p.inlineData?.data)
  if (!img) throw new Error('image: no image (' + JSON.stringify(j).slice(0, 200) + ')')
  return Buffer.from(img.inlineData.data, 'base64')
}

fs.mkdirSync(OUT, { recursive: true })
const tok = await token()
for (const d of DIRECTIONS) {
  try {
    const png = await imagen(d.prompt, tok)
    const p = path.join(OUT, `dir-${d.id}.png`)
    fs.writeFileSync(p, png)
    console.log(`RESULT:{"dir":${d.id},"name":"${d.name}","file":"${p}","bytes":${png.length}}`)
  } catch (e) {
    console.log(`RESULT:{"dir":${d.id},"name":"${d.name}","error":"${String(e).slice(0, 150).replace(/"/g, "'")}"}`)
  }
}
console.log('DONE')
