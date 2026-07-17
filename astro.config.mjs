// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://scayla.co.il',
  output: 'static',
  trailingSlash: 'never',
  // עמודים שמסומנים noIndex חייבים להיות מסוננים גם מה-sitemap · אחרת הם יושבים
  // בו ומסומנים noindex בו-זמנית, וזו סתירה שגוגל מדווח עליה.
  //   /quizz · עמוד נחיתה לפיילוט, כניסה מקישור ישיר בלבד.
  //   /scan  · זמני. המכונה עוד לא מחוברת. כשהיא תחובר · מסירים noIndex מ-scan.astro
  //            ומוציאים אותו מהסינון הזה, בשני צעדים באותו קומיט.
  integrations: [sitemap({ filter: (page) => !/\/(quizz|scan)\/?$/.test(page) })],
  build: {
    format: 'file',
  },
  // i18n-ready (Noy · question 10): Hebrew only today, structured so an English
  // locale can be added later by appending 'en' to locales (URLs get /en/ prefix)
  // without a rewrite. hreflang tags are scaffolded in BaseLayout.astro.
  i18n: {
    defaultLocale: 'he',
    locales: ['he'],
    routing: { prefixDefaultLocale: false },
  },
});
