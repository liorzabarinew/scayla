// rss.xml · פיד RSS 2.0 של המגזין, נבנה ידנית בלי תלות חדשה (endpoint סטטי של Astro).
// המגזין מפרסם מאמר ביום · פיד נותן לקוראים, לאגרגטורים ולסוכני-AI דרך רשמית לעקוב.
// draft = בבנק ולא באוויר · needsReview = מוחזק לעין אנושית · שניהם מחוץ לפיד,
// באותו סינון כמו gen-llms.mjs.
import { getCollection } from 'astro:content';

const SITE = 'https://scayla.co.il';

// בריחת ישויות XML · כותרות ותיאורים מכילים גרשיים ולעיתים & (למשל "SEO & GEO").
const esc = (s) =>
  String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');

export async function GET() {
  const posts = (
    await getCollection('magazine', ({ data }) => !data.draft && !data.needsReview)
  )
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf())
    .slice(0, 30); // הפיד הוא חלון · הארכיון המלא חי ב-/magazine וב-sitemap

  const items = posts
    .map((p) => {
      // p.id כבר lowercase (ה-loader של Astro מנרמל) · encodeURI כי ה-slug בעברית
      const url = `${SITE}/magazine/${encodeURI(p.id)}`;
      return `    <item>
      <title>${esc(p.data.title)}</title>
      <link>${url}</link>
      <guid isPermaLink="true">${url}</guid>
      <description>${esc(p.data.description)}</description>
      <pubDate>${p.data.pubDate.toUTCString()}</pubDate>
    </item>`;
    })
    .join('\n');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>הבלוג של Scayla · GEO ו-SEO לחנויות שופיפיי</title>
    <link>${SITE}/magazine</link>
    <atom:link href="${SITE}/rss.xml" rel="self" type="application/rss+xml"/>
    <description>GEO, קידום אורגני לשופיפיי ושיווק לאיקומרס ישראלי · מדריכים מבוססי מחקר, כתובים כמו שמנועי AI אוהבים לצטט.</description>
    <language>he</language>
    <lastBuildDate>${new Date().toUTCString()}</lastBuildDate>
${items}
  </channel>
</rss>
`;

  return new Response(xml, {
    headers: { 'Content-Type': 'application/rss+xml; charset=utf-8' },
  });
}
