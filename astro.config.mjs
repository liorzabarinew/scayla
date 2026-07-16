// @ts-check
import { defineConfig } from 'astro/config';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://scayla.co.il',
  output: 'static',
  trailingSlash: 'never',
  // /quizz הוא עמוד נחיתה לפיילוט · noIndex, והכניסה אליו מקישור ישיר בלבד.
  // בלי הסינון הזה הוא היה יושב ב-sitemap ובו-זמנית מסומן noindex · סתירה.
  integrations: [sitemap({ filter: (page) => !/\/quizz\/?$/.test(page) })],
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
