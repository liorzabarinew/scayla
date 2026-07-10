// fact-glossary.mjs · Scayla — עובדות-עוגן קנוניות (אנלוגי ל-brand-glossary.mjs).
//
// למה: נתונים משותפים בין מאמרים נוטים לסטות. הגלוסר עושה שני דברים:
//   factsForPrompt() — מזריק את הקנון לכותב, כך שהטיוטה הראשונה מתחילה מהאמת.
//   lintFacts(md)    — מדגל דטרמיניסטית רק סטיות בטוחות-לזיהוי (high-confidence).
//
// הערה: בניגוד לבנק-קט (סכום הפקדה קבוע, חלוקת 50/40/10), לתחום ה-SEO/GEO כמעט אין
// מספרים קנוניים-לעד — הנחיות אורך-title/description משתנות ותלויות-הקשר, ולכן איננו
// מקבעים אותן כ"עובדה". FACTS מכיל רק הבהרות-מושג יציבות. הרשימה מכוונת להישאר רזה.

export const FACTS = [
  {
    id: 'seo-vs-geo',
    note: 'ההבחנה בין SEO ל-GEO',
    canonical: 'SEO מדרג עמודים בתוצאות החיפוש; GEO מכניס את המותג לתוך התשובה שמנוע-AI מייצר',
    hint: 'SEO = דירוג עמודים בתוצאות. GEO = הופעה בתוך תשובת מנוע-AI. אל תערבב.',
    wrong: [],
  },
]

// מוזרק ל-writePrompt: הכותב מתחיל מהקנון.
export function factsForPrompt() {
  if (!FACTS.length) return ''
  return 'הבהרות-מושג קנוניות של Scayla (השתמש בהן בדיוק, אל תסטה):\n'
    + FACTS.map((f) => `- ${f.note}: ${f.canonical}.`).join('\n')
}

// בקרה דטרמיניסטית: רק סטיות בטוחות-לזיהוי. מחזיר מערך issues (ריק = תקין).
export function lintFacts(md) {
  const issues = []
  for (const f of FACTS) {
    if (f.skipIf && f.skipIf.test(md)) continue
    for (const re of f.wrong || []) {
      if (re.test(md)) { issues.push(`עובדה לא-קנונית (${f.id}): ${f.hint}`); break }
    }
  }
  return issues
}
