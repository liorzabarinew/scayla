import sharp from 'sharp'
import fs from 'fs'
const dir='public/covers/_sketch'
const out={}
for(const n of [1,2,3,4]){
  const b=await sharp(`${dir}/dir-${n}.png`).resize(900).webp({quality:82}).toBuffer()
  out[n]='data:image/webp;base64,'+b.toString('base64')
}
fs.writeFileSync(`${dir}/_thumbs.json`, JSON.stringify(out))
console.log('sizes:', Object.fromEntries(Object.entries(out).map(([k,v])=>[k, Math.round(v.length/1024)+'KB'])))
