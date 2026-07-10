# Scayla · אתר השיווק (scayla.co.il)

אתר סטטי מלא ב-**Astro**, עברית RTL, Light + Dark mode, בנוי לפי הדיזיין-סיסטם של Scayla
(מערכת ה-indigo-violet · `.db-*` tokens). מיועד לפריסה ב-**Cloudflare Pages**.
משלב את תשובות נוי ל"10 השאלות" מהבריף (מילות מפתח, עמודי שירות, מבנה URL, אשכולות מגזין, סכמות, i18n).

## Stack

- **Astro 5** · אתר סטטי בלבד (אין backend, אין DB, אין תלות-פלטפורמה). הפלט: HTML/CSS/JS סטנדרטי.
- **@astrojs/sitemap** · sitemap אוטומטי (+ robots.txt).
- **Heebo** (משקלים 300–900) · **self-hosted** ב-`public/fonts/` (subsets עברית + לטינית, woff2 variable). אפס בקשות צד-שלישי.
- ללא framework צד-לקוח · JS ואנילה מינימלי (מד נראות, בארי SoV, theme toggle, תפריט מובייל).

## התקנה והרצה

```bash
npm install
npm run dev       # שרת פיתוח · http://localhost:4321
npm run build     # בנייה ל-dist/
npm run preview   # תצוגה מקדימה של ה-build
```

`npm run build` נבדק ועובר נקי (16 עמודים) · הפלט ב-`dist/` סטטי לחלוטין.
נבדק ויזואלית ב-Chrome: light + dark, דסקטופ + מובייל, ואפס שגיאות קונסול בכל העמודים.

## פריסה ל-Cloudflare Pages (הדומיין scayla.co.il)

1. דחפו את התיקייה ל-repo (GitHub/GitLab).
2. ב-Cloudflare Dashboard → **Workers & Pages → Create → Pages → Connect to Git**.
3. הגדרות build:
   - **Framework preset:** Astro
   - **Build command:** `npm run build`
   - **Build output directory:** `dist`
4. אחרי הפריסה הראשונה: **Custom domains → scayla.co.il** (ה-DNS כבר ב-Cloudflare).
5. `public/_headers` כבר מגדיר cache immutable לפונטים ול-assets + כותרות אבטחה בסיסיות.

> לחלופין, פריסה ידנית: `npm run build` ואז `npx wrangler pages deploy dist`.

## מפת העמודים

| נתיב | מה זה |
|------|-------|
| `/` | הבית · נחיתה long-form (Hero + מד נראות, הבעיה, 4 שלבים, הבידול הרב-מנועי, יכולות, אמינות + עדויות, תמחור, FAQ, CTA) |
| `/seo-shopify` | עמוד שירות · קידום אורגני ל-Shopify (תשובת נוי, שאלה 2) |
| `/geo` | עמוד שירות · אופטימיזציה למנועי AI · GEO |
| `/ai-visibility` | עמוד שירות · הופעה ב-ChatGPT וב-Gemini |
| `/pricing` | תמחור · Growth $49 · Scale $69 · Max $99 + השוואות + FAQ חיוב |
| `/magazine` | המגזין · מסודר כ-silo לפי אשכולות (שאלה 5) |
| `/magazine/<slug-עברי>` | תבנית פוסט · slugs בעברית (שאלה 4) |
| `/about` | אודות · הסיפור + המייסדים + עדויות |
| `/faq` | שאלות נפוצות מלא |
| `/contact` | צור קשר + זרימת דמו (טופס · שאלה 8) |
| `/privacy` · `/terms` · `/accessibility` | קונטיינרים ריקים · התוכן יוזרק (noindex עד אז) |
| `/404` | עמוד שגיאה ממותג |

## מבנה התיקיות

```
scayla-website/
├── astro.config.mjs           # site · sitemap · static · i18n-ready (he)
├── public/
│   ├── fonts/                 # Heebo self-hosted (hebrew + latin, variable woff2)
│   ├── _headers               # Cloudflare Pages cache/security headers
│   ├── favicon.svg
│   └── robots.txt
└── src/
    ├── styles/
    │   ├── tokens.css         # ⭐ כל ה-design tokens (light + dark) · מקור אמת יחיד
    │   └── global.css         # base, layout primitives, buttons, focus, motion
    ├── layouts/
    │   └── BaseLayout.astro   # html[lang=he][dir=rtl], SEO meta, hreflang scaffold,
    │                          #   BreadcrumbList JSON-LD, theme boot, header+footer
    ├── components/
    │   ├── SiteHeader.astro   # ניווט + theme toggle + תפריט מובייל
    │   ├── SiteFooter.astro   # כולל עמודת "פתרונות" לעמודי השירות
    │   ├── VisibilityGauge.astro  # מד הנראות המונפש (1300ms, rAF, reduced-motion)
    │   ├── AnswerViewer.astro     # צופה תשובות AI (מותג ירוק / נעדר אדום)
    │   ├── SovRace.astro          # בארי מרוץ נתח-קול (RTL, מונפש)
    │   ├── PricingCards.astro     # 3 טירים (data/pricing.ts)
    │   ├── FaqAccordion.astro     # אקורדיון נגיש + FAQPage schema אופציונלי
    │   ├── Testimonials.astro     # עדויות אמיתיות (מאושרות) + מוני אמון
    │   ├── CtaBand.astro          # רצועת CTA גרדיאנט
    │   └── LegalPage.astro        # שלד עמוד משפטי (קונטיינר ריק)
    ├── data/
    │   ├── pricing.ts         # טירים + SHOPIFY_APP_URL (placeholder)
    │   └── faq.ts             # שאלות בית + שאלות מלאות
    ├── content.config.ts      # קולקציית המגזין + רשימת האשכולות (CLUSTERS)
    ├── content/magazine/      # פוסטים = קבצי .md בשמות עבריים (= ה-slug)
    └── pages/                 # כל העמודים (ראו מפה למעלה)
```

### הוספת עמוד שירות/נחיתה עתידי
יוצרים `src/pages/<slug>.astro` (slug אנגלי נקי, לפי שאלה 4), עוטפים ב-`BaseLayout`
ומשתמשים בקומפוננטות הקיימות. שלושת עמודי השירות הקיימים הם התבנית לחיקוי.

### הוספת פוסט למגזין (או הזרמה מהמכונה)
קובץ `.md` חדש ב-`src/content/magazine/` · **שם הקובץ בעברית = ה-slug**. frontmatter:

```yaml
---
title: "כותרת"
description: "תיאור meta · עד 130 תווים"
pubDate: 2026-08-01
cluster: "GEO ואופטימיזציה למנועי AI"   # אחד מ-CLUSTERS ב-content.config.ts
readingMinutes: 6
demo: false
---
```

אשכולות קיימים: `GEO ואופטימיזציה למנועי AI` · `SEO לחנויות שופיפיי` ·
`שיווק לאיקומרס ישראלי` · `מדריכים וכלים`. עמוד המגזין מתקבץ לפיהם אוטומטית.

## Design system

- `src/styles/tokens.css` הוא **מקור האמת**: פלטת ה-indigo-violet, ניוטרלים, אינדיקטורים
  סמנטיים (ירוק=חיובי בלבד, אדום=בעיה אמיתית בלבד), radius, צללים, motion.
- **Dark mode**: הרחבה של אותם tokens תחת `[data-theme='dark']` · toggle בהדר, כיבוד
  `prefers-color-scheme`, שמירה ב-localStorage, בלי פלאש בטעינה.
- **RTL**: מאפיינים לוגיים בלבד (`inline-start/end`, `border-inline-*`). מספרים/אחוזים/$/₪
  עטופים ב-`.num` (LTR isolate + tabular-nums). ▲/▼ משמאל למספר.
- **Motion**: 180–360ms `cubic-bezier(.22,1,.36,1)` · המד סופר ~1300ms (easeOutCubic) ·
  fade-up עם guard ל-no-JS · הכל מכבד `prefers-reduced-motion`.
- **נגישות (AA)**: HTML סמנטי, skip-link, focus גלוי, aria-labels, ניגודיות AA בשני המצבים,
  אקורדיון `details/summary` נייטיבי, תפריט מובייל עם aria-expanded.

## SEO (לפי תשובות נוי)

- **Meta**: תבנית "[עמוד] · Scayla", תיאורים עד ~130 תווים, canonical, og tags.
  בית: "Scayla · נראות ב-Google וב-AI לחנויות שופיפיי".
- **מילות מפתח** שזורות בכותרות ובקופי: קידום אורגני לשופיפיי · GEO · אופטימיזציה
  ל-ChatGPT · קידום חנות שופיפיי · אופטימיזציה למנועי AI · נראות ב-AI · קידום בג'ימיני · קידום בקלוד.
- **JSON-LD**: Organization + WebSite (עם SearchAction) בבית · SoftwareApplication + 3
  Offers ב-`/pricing` · FAQPage ב-`/faq` ובעמודי השירות · BreadcrumbList בכל האתר
  (BaseLayout) · Article בפוסטים.
- **sitemap-index.xml + robots.txt** מוכנים.
- **i18n**: מוכן מראש לאנגלית · `astro.config.mjs` עם `i18n.locales` (מוסיפים `'en'`),
  hreflang scaffold ב-BaseLayout. אין צורך ב-rewrite.

## ⚠️ רשימת PLACEHOLDERS · להשלמה בהטמעה

| # | מה | איפה | הערות |
|---|-----|-------|-------|
| 1 | **קישור לאפליקציה ב-Shopify App Store** | `src/data/pricing.ts` → `SHOPIFY_APP_URL` | כרגע `#shopify-app-store-placeholder` · כל כפתורי "התקינו מ-Shopify" מושכים מכאן |
| 1ב | **קישור "קבעו דמו" (URL של Google מנוי)** | `src/data/pricing.ts` → `DEMO_URL` | כרגע `#demo-placeholder` · **כל** כפתורי "קבעו דמו" באתר מושכים מכאן ונפתחים בטאב חדש. שינוי שורה אחת = כל הכפתורים מתעדכנים |
| 2 | **צילום דשבורד אמיתי** | הבית · hero card (`hc-peek`) | מסומן "PLACEHOLDER · צילום דשבורד" · לייצא ולהחליף |
| 3 | **לוגו לקוחות** | הבית (אמינות) + `/about` | Toys R Us · Femina · Mustela — ממתין לאישור שימוש. העדויות עצמן כבר אמיתיות ומאושרות (Testimonials.astro) |
| 4 | **גוף עמודי המשפט** | `/privacy` · `/terms` · `/accessibility` | קונטיינר ריק עם כותרת בלבד (`LegalPage.astro`, `data-legal-container`) · העמודים `noindex` עד הזרקת התוכן |
| 5 | **endpoint לטופס יצירת קשר / דמו** | `/contact` → `action="#form-endpoint-placeholder"` | שדות לפי שאלה 8: שם, אימייל, כתובת חנות, הודעה · צוות הפיתוח מחבר webhook / CF Pages Function |
| 6 | **פוסטי המגזין** | `src/content/magazine/*.md` | 3 פוסטי דמו מסומנים `demo: true` באשכולות GEO / SEO-Shopify / מדריכים · המכונה תזרים תוכן אמיתי |
| 7 | **נתוני ההמחשה** | הבית + `/ai-visibility` · gauge 34%, בארי SoV, תשובות AI | דאטה דמו · מסומן בעמוד ("המספרים כאן להמחשה") |
| 8 | **תמונת OG** | `BaseLayout.astro` | אין עדיין `og:image` · להוסיף נכס 1200×630 ממותג |

## פונט Heebo

self-hosted ב-`public/fonts/` (הורד מ-Google Fonts v28, variable 300–900, subsets
עברית + לטינית). עובד לגמרי offline / ללא בקשות צד-שלישי. fallback:
`-apple-system, 'Segoe UI', 'Arial Hebrew', 'Noto Sans Hebrew', Arial, sans-serif`.
