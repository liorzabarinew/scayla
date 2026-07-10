# Scayla · אתר שיווקי — מסירה טכנית (לקלוד של ליאור)

אתר הנחיתה של Scayla. Astro (אתר סטטי), עברית RTL, light+dark, נגישות AA, SEO/GEO מלא.

## Stack
- **Astro** (`output: 'static'`, `build.format: 'file'`, `trailingSlash: 'never'`)
- HTML/CSS/JS סטנדרטי · Heebo self-hosted · בלי backend/DB
- Tokens ריכוזיים ב-`src/styles/tokens.css` · קומפוננטות ב-`src/components/`

## הרצה מקומית
```bash
npm install
npm run dev      # פיתוח
npm run build    # בנייה → dist/
npm run preview  # תצוגה מקומית של ה-build
```

## פריסה
**כרגע חי על Vercel** (`vercel --prod`). `vercel.json` כולל `cleanUrls: true` (חובה — כי הבנייה מייצרת קבצי `.html` שטוחים).

**ליעד הסופי — Cloudflare Pages** (הדומיין scayla.co.il):
- Build command: `npm run build` · Output: `dist`
- אם עוברים ל-CF Pages: לוודא שקיים מקבילה ל-cleanUrls (CF מטפל בזה אוטומטית ברוב המקרים).

## חשוב — לחבר את הדומיין
כל ה-canonicals, sitemap ו-llms.txt מצביעים ל-**https://scayla.co.il**. לחבר את הדומיין (Vercel/Cloudflare) לפני/בהשקה.

## Placeholders להשלים לפני השקה (חוסמי השקה)
1. `src/data/pricing.ts` → **`SHOPIFY_APP_URL`** (לינק ה-App Store האמיתי) + **`DEMO_URL`** (לינק הדמו).
2. עמודי מומחה → קישורי **LinkedIn** אמיתיים (כרגע placeholder).
3. לוגו לקוחות · צילומי דשבורד אמיתיים (כרגע מוקאפ).
4. גוף עמודי המשפט (`/privacy`, `/terms`, `/accessibility`) — כרגע כותרת + noindex.

## מבנה עמודים (22)
בית · מחירון · seo-shopify · geo · ai-visibility · chatgpt-seo · gemini-seo · perplexity-seo · claude-seo · check · magazine (+ פוסטים + cluster) · experts (+ noy-keitel · lior-tzabari) · about · faq · contact · privacy/terms/accessibility.

## SEO/GEO — מוכן
titles ≤60 · descriptions ≤130 · schema עשיר (Organization/WebSite/Article+Person/FAQPage/ProfilePage/SoftwareApplication+Offer/BreadcrumbList) · canonicals נקיים · **llms.txt** · **robots.txt עם זחלני AI** · sitemap · og:image · favicon.

## הערה
מצב כהה/בהיר **אוטומטי לפי שעון ישראל** (20:00–07:00 כהה) — אין toggle ידני (בכוונה).
