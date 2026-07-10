import crypto from 'node:crypto'; import fs from 'node:fs'; import sharp from 'sharp'
const SA=JSON.parse(process.env.GOOGLE_SA); const PROJECT=process.env.GCP_PROJECT||SA.project_id; const REGION='us-central1'; const M='gemini-2.5-flash-image'
async function tok(){const n=Math.floor(Date.now()/1000);const h=Buffer.from(JSON.stringify({alg:'RS256',typ:'JWT'})).toString('base64url');const c=Buffer.from(JSON.stringify({iss:SA.client_email,scope:'https://www.googleapis.com/auth/cloud-platform',aud:'https://oauth2.googleapis.com/token',iat:n,exp:n+3600})).toString('base64url');const s=crypto.sign('RSA-SHA256',Buffer.from(h+'.'+c),SA.private_key).toString('base64url');const r=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'content-type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:h+'.'+c+'.'+s})});return (await r.json()).access_token}
const prompt=`Abstract modern geometric composition for a premium magazine article hero banner, drawn digital art (NOT a photo, NOT 3D). RICH DEEP background: deep indigo #211c86 and royal violet #5546d6 gradient, dark and saturated (this is a DARK hero, not light). Composition: on the LEFT side, overlapping translucent glossy rounded-rectangle shapes in violet, and a smooth glowing curve that rises from the lower-left and peaks at a single bright warm-gold node, with a scatter of soft glowing dots suggesting a network. The RIGHT two-thirds is calmer deep-indigo gradient with generous negative space. Elegant, techy, premium, cinematic soft glow. Absolutely NO text, no words, no letters, no numbers, no logos, no UI, no human faces, no photorealism. Wide 16:9 horizontal banner composition.`
const t=await tok()
const r=await fetch(`https://${REGION}-aiplatform.googleapis.com/v1/projects/${PROJECT}/locations/${REGION}/publishers/google/models/${M}:generateContent`,{method:'POST',headers:{authorization:'Bearer '+t,'content-type':'application/json'},body:JSON.stringify({contents:[{role:'user',parts:[{text:prompt}]}],generationConfig:{responseModalities:['IMAGE']}})})
const j=await r.json(); if(j.error){console.log('ERR',JSON.stringify(j.error).slice(0,200));process.exit(1)}
const img=(j.candidates?.[0]?.content?.parts||[]).find(p=>p.inlineData?.data)
if(!img){console.log('no image',JSON.stringify(j).slice(0,200));process.exit(1)}
const buf=Buffer.from(img.inlineData.data,'base64')
const slug='אופטימיזציית-על-לדפי-מוצר-בשופיפיי'
fs.mkdirSync('public/covers',{recursive:true})
// wide hero crop: 1600x760 (~21:10), cover-fit from the square (keeps left focal + right space)
await sharp(buf).resize(1600,760,{fit:'cover',position:'left'}).webp({quality:86}).toFile(`public/covers/${slug}.webp`)
// also a thumb for the gallery/preview
console.log('wrote public/covers/'+slug+'.webp', Math.round(buf.length/1024)+'KB source')
