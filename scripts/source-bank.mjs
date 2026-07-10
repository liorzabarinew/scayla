// ── בנק-מקורות אמין (Trusted Source Bank) · Scayla ──
// רשימה אוצרת של מקורות איכותיים שהמכונה מתבקשת *להיוועץ* בהם בשלב התדריך:
//  - kind:'inspiration' — בלוגים/מגזינים מקצועיים ל-SEO/GEO/איקומרס: לזוויות, מבנה וטון. אסור להעתיק.
//  - kind:'authority'   — מקורות ראשוניים/רשמיים לעובדות מאומתות (תיעוד פלטפורמה, מחקר). עדיף לייחס אליהם נתון.
// אינו רשימת-קישורים-לפרסום: זה רק כיוון-מחקר. הקישורים בפועל נגזרים מ-grounding אמיתי ומ-related.
export const TRUSTED_SOURCES = [
  // סמכות — מקורות ראשוניים ותיעוד רשמי (לייחוס עובדות, עם URL ספציפי לעמוד)
  { name: 'Google Search Central', url: 'https://developers.google.com/search', kind: 'authority', note: 'התיעוד הרשמי של Google ל-SEO, structured data, ו-AI features' },
  { name: 'Schema.org', url: 'https://schema.org/', kind: 'authority', note: 'אוצר-המילים הרשמי לנתונים מובנים (Product/FAQ/Organization)' },
  { name: 'Shopify Help & Blog', url: 'https://www.shopify.com/blog', kind: 'authority', note: 'תיעוד ומדריכי-מקור של Shopify ל-SEO, דפי-מוצר וקטגוריה' },
  { name: 'Google Search Central Blog', url: 'https://developers.google.com/search/blog', kind: 'authority', note: 'עדכוני-אלגוריתם רשמיים, Core Web Vitals, AI Overviews' },
  { name: 'web.dev (Google)', url: 'https://web.dev/', kind: 'authority', note: 'Core Web Vitals, ביצועים, מדדי-מהירות רשמיים' },
  // השראה — מגזינים מקצועיים מובילים ל-SEO/GEO (לזוויות, מבנה וטון בלבד — אסור להעתיק)
  { name: 'Search Engine Land', url: 'https://searchengineland.com/', kind: 'inspiration', note: 'חדשות ועומק SEO/SEM; מקור-אמת לעדכוני-תעשייה' },
  { name: 'Search Engine Journal', url: 'https://www.searchenginejournal.com/', kind: 'inspiration', note: 'מדריכים ומחקרי SEO/GEO; מבנה how-to' },
  { name: 'Ahrefs Blog', url: 'https://ahrefs.com/blog/', kind: 'inspiration', note: 'מחקרי-data על מילות-מפתח, קישורים וזרימת-תנועה' },
  { name: 'Moz Blog', url: 'https://moz.com/blog', kind: 'inspiration', note: 'יסודות SEO, כוונת-חיפוש, on-page' },
  { name: 'Backlinko', url: 'https://backlinko.com/blog', kind: 'inspiration', note: 'מדריכי-עומק מבוססי-מחקר; מבנה מנצח ל-SEO' },
  { name: 'Shopify Ecommerce Blog', url: 'https://www.shopify.com/blog/topics/ecommerce', kind: 'inspiration', note: 'שיווק לאיקומרס, המרה, בניית-חנות' },
  // השראה — GEO / חיפוש-AI (התחום החדש; לזוויות ומבנה, להתאים תמיד לישראל)
  { name: 'Search Engine Land — AI/GEO', url: 'https://searchengineland.com/library/generative-ai', kind: 'inspiration', note: 'GEO, AI Overviews, ציטוט במנועי-תשובות' },
]

// בלוק-תדריך: מציג את הבנק כ"כיווני-מחקר", עם איסור-העתקה מפורש על מקורות-ההשראה.
export function sourceBankForPrompt() {
  const insp = TRUSTED_SOURCES.filter((s) => s.kind === 'inspiration')
  const auth = TRUSTED_SOURCES.filter((s) => s.kind === 'authority')
  const line = (s) => `  - ${s.name} (${s.url}) — ${s.note}`
  return `מקורות-אמין להיוועצות (חפש בהם דרך Google כדי להעמיק, הם לא רשימת-קישורים לשתול):
מקורות-השראה (לזוויות, מבנה וטון בלבד — אסור להעתיק או לשכתב-קלות אף משפט מהם):
${insp.map(line).join('\n')}
מקורות-סמכות (עדיף לאמת ולייחס נתונים אליהם, עם URL ספציפי לעמוד הנתון):
${auth.map(line).join('\n')}`
}
