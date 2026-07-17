/**
 * GET /scan/<id> · העמוד הייחודי של הליד.
 *
 * האתר סטטי, אז אין דרך לייצר מראש נתיב לכל ג'וב. במקום זה: כל /scan/<id>
 * מגיש את אותו עמוד סטטי (/scan) דרך ASSETS, והלקוח קורא את ה-id מהנתיב
 * ומתחבר חזרה לריצה שלו.
 *
 * למה זה חשוב: הליד מקבל את הקישור הזה במייל. `?job=abc` הוא פרמטר, לא עמוד.
 * `/scan/weshoes-co-il-a3f9c2` נראה, מרגיש ומשתף כמו העמוד שלו.
 */
interface Env { ASSETS: Fetcher }

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const url = new URL(request.url);
  // build.format:'file' → העמוד יושב כ-/scan.html
  url.pathname = '/scan.html';
  const res = await env.ASSETS.fetch(new Request(url.toString(), { headers: request.headers }));
  // מגישים כ-HTML חי · לא נותנים לקצה לשמור עמוד של ליד ספציפי
  const h = new Headers(res.headers);
  h.set('cache-control', 'no-store');
  return new Response(res.body, { status: res.status, headers: h });
};
