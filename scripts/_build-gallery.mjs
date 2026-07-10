import fs from 'fs'
const t = JSON.parse(fs.readFileSync('public/covers/_sketch/_thumbs.json','utf8'))
const dirs = [
  {n:1, name:'Flat vector editorial', he:'וקטור-עריכה שטוח', desc:'חנות עולה על פודיום עם חץ צמיחה, זכוכיות מגדלת ובועות. חם, נקי, ידידותי.'},
  {n:2, name:'Soft 3D clay', he:'תלת-ממד רך (clay)', desc:'אובייקט תלת-ממד מט עם טבעות-שידור. פרימיום, מוצרי, עכשווי.'},
  {n:3, name:'Abstract gradient', he:'אבסטרקט גרדיאנט', desc:'צורות שקופות ועקומה עולה לנקודת-זהב. הכי טכי, המון מקום לכותרת.'},
  {n:4, name:'Isometric line-art', he:'איזומטרי קו-רזה', desc:'חנות מחוברת בקווים לבועות-תשובה. מינימלי, מדויק, טכנולוגי.'},
]
const cards = dirs.map(d=>`
    <figure class="card">
      <div class="imgwrap"><img src="${t[d.n]}" alt="${d.name}" loading="lazy" /></div>
      <figcaption>
        <div class="row"><span class="num">${d.n}</span><h2>${d.he}</h2></div>
        <p class="en">${d.name}</p>
        <p class="desc">${d.desc}</p>
        <button onclick="sendPrompt('בוא נרוץ עם כיוון ${d.n} · ${d.he}')">בחר בכיוון ${d.n}</button>
      </figcaption>
    </figure>`).join('')
const html = `<section class="wrap">
  <header>
    <p class="eyebrow">קאברים למגזין · נוצרו ב-Gemini</p>
    <h1>ארבעה כיוונים לקאבר</h1>
    <p class="lede">כולם בפלטת המותג (אינדיגו-סגול + לבנדר + נגיעת זהב), נושאי SEO/GEO לשופיפיי. בחר סגנון-בית, ואריץ ממנו קאבר לכל מאמר, אחיד.</p>
  </header>
  <div class="grid">${cards}</div>
  <p class="foot">היצירה יצאה ריבועית · הקאבר הסופי ייחתך ל-16:9 עם מקום לכותרת מעליו.</p>
</section>
<style>
  :root{ --ink:#1d1d1f; --muted:#6e6e73; --paper:#f6f4fb; --card:#fff; --hair:#e8e8ed;
    --accent:#5546d6; --lav:#8b76f2; --gold:#FFC24B; --wash:#f2effd; --soft:#e4ddf8; }
  @media (prefers-color-scheme:dark){ :root{ --ink:#f3f1fa; --muted:#a5a0b3; --paper:#121016; --card:#1c1922; --hair:#2d2937; --accent:#a99bf7; --wash:#251f3d; --soft:#3a3160; } }
  :root[data-theme=dark]{ --ink:#f3f1fa; --muted:#a5a0b3; --paper:#121016; --card:#1c1922; --hair:#2d2937; --accent:#a99bf7; --wash:#251f3d; --soft:#3a3160; }
  :root[data-theme=light]{ --ink:#1d1d1f; --muted:#6e6e73; --paper:#f6f4fb; --card:#fff; --hair:#e8e8ed; --accent:#5546d6; --wash:#f2effd; --soft:#e4ddf8; }
  *{box-sizing:border-box}
  .wrap{ direction:rtl; font-family:'Heebo',-apple-system,'Segoe UI',Arial,sans-serif; color:var(--ink);
    background:var(--paper); padding:clamp(24px,5vw,56px); min-block-size:100%; }
  header{ max-inline-size:760px; margin:0 auto clamp(28px,4vw,44px); text-align:center; }
  .eyebrow{ color:var(--accent); font-weight:700; font-size:13px; letter-spacing:.06em; margin:0 0 10px; }
  h1{ font-size:clamp(28px,4.5vw,44px); font-weight:800; letter-spacing:-.02em; margin:0 0 14px; text-wrap:balance; }
  .lede{ color:var(--muted); font-size:clamp(15px,1.8vw,18px); line-height:1.7; margin:0; }
  .grid{ display:grid; grid-template-columns:repeat(2,1fr); gap:clamp(16px,2.5vw,26px); max-inline-size:1080px; margin:0 auto; }
  @media(max-width:720px){ .grid{ grid-template-columns:1fr; } }
  .card{ margin:0; background:var(--card); border:1px solid var(--hair); border-radius:18px; overflow:hidden;
    box-shadow:0 10px 28px -18px rgba(29,29,31,.25); transition:transform .25s cubic-bezier(.22,1,.36,1), box-shadow .25s; }
  .card:hover{ transform:translateY(-4px); box-shadow:0 18px 40px -20px rgba(85,70,214,.4); }
  .imgwrap{ aspect-ratio:16/10; overflow:hidden; background:var(--wash); border-block-end:1px solid var(--hair); }
  .imgwrap img{ inline-size:100%; block-size:100%; object-fit:cover; display:block; }
  figcaption{ padding:20px 22px 22px; }
  .row{ display:flex; align-items:center; gap:12px; }
  .num{ inline-size:30px; block-size:30px; flex:none; display:grid; place-items:center; border-radius:9px;
    background:var(--wash); color:var(--accent); font-weight:800; font-size:15px; border:1px solid var(--soft); }
  h2{ font-size:19px; font-weight:800; margin:0; letter-spacing:-.01em; }
  .en{ color:var(--muted); font-size:12.5px; font-weight:600; letter-spacing:.03em; margin:6px 0 0; direction:ltr; text-align:right; }
  .desc{ color:var(--muted); font-size:14px; line-height:1.6; margin:10px 0 16px; }
  button{ font-family:inherit; font-weight:700; font-size:14.5px; color:#fff; background:var(--accent);
    border:0; border-radius:999px; padding:11px 20px; cursor:pointer; transition:background .18s, transform .18s; }
  button:hover{ background:var(--lav); }
  button:active{ transform:scale(.97); }
  button:focus-visible{ outline:3px solid var(--gold); outline-offset:2px; }
  .foot{ text-align:center; color:var(--muted); font-size:13px; margin:clamp(24px,4vw,40px) auto 0; max-inline-size:600px; }
</style>`
fs.writeFileSync('/private/tmp/claude-501/-Users-liorzabari-Downloads-Claude/40ce897c-513f-495f-9d64-5208dc277a34/scratchpad/cover-directions.html', html)
console.log('wrote gallery,', Math.round(html.length/1024)+'KB')
