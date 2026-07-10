// brand-glossary.mjs · Scayla — איות עברי תקני של פלטפורמות/מותגים לועזיים בתוכן.
//
// למה זה קיים: עורך-הלשון של המכונה (qaCopyEdit) לא יכול לדעת תעתיק-מותג נכון —
// "שופייפיי" נראה לו עקבי בתוך המאמר. לכן צריך אכיפה דטרמיניסטית + הזרקת מידע
// סמנטי למגיה (בלבול בין מנוע-חיפוש למנוע-תשובות, בין פלטפורמה לכלי).
//
// canonical  = האיות התקני (מקור: אתר רשמי / ויקיפדיה עברית).
// variants   = איותים שגויים נפוצים → ינורמלו ל-canonical (תופס גם צורות מוטות: בשופייפיי→בשופיפיי).
// note       = למה זה (מוזרק למגיה).
// confusable = מותג/מונח קרוב שאסור לבלבל איתו (סמנטי — מוזרק למגיה בלבד).

export const BRANDS = [
  { canonical: 'שופיפיי', en: 'Shopify',    note: 'פלטפורמת האיקומרס',                   variants: ['שופייפיי', 'שופיפי', 'שופיפייי'] },
  { canonical: "צ'אט GPT", en: 'ChatGPT',   note: 'מנוע-תשובות של OpenAI',               variants: ['צ׳אט GPT', 'צאט GPT', 'צ׳אטג׳יפיטי', "צ'אטג'יפיטי", 'ChatGPT-'], confusable: 'GPT (המודל) — צ׳אט GPT הוא המוצר/הממשק' },
  { canonical: "ג'מיני", en: 'Gemini',      note: 'מנוע-התשובות והמודל של Google',       variants: ['גמיני', 'ג׳ימיני', 'ג׳מני'] },
  { canonical: 'פרפלקסיטי', en: 'Perplexity', note: 'מנוע-תשובות (answer engine)',        variants: ['פרפלקסטי', 'פרפלקסיטיי', 'פרפלeksיטי'] },
  { canonical: 'גוגל',    en: 'Google',     note: 'מנוע-החיפוש',                          variants: ['גוגל׳'],  confusable: "ג'מיני (מנוע-התשובות של גוגל — לא מנוע-החיפוש)" },
  { canonical: 'קלוד',    en: 'Claude',     note: 'מנוע-התשובות של Anthropic',            variants: ['קלאוד', 'קלוד׳'] },
  { canonical: 'וורדפרס', en: 'WordPress',  note: 'פלטפורמת אתרים (מתחרה של שופיפיי)',    variants: ['וורדפרז', 'וורד-פרס', 'וורדפראס'] },
  { canonical: 'גוגל אנליטיקס', en: 'Google Analytics', note: 'כלי-מדידת-תנועה',          variants: ['גוגל אנליטיקה'] },
  { canonical: 'סרץ׳ קונסול', en: 'Search Console', note: 'כלי-הדיווח של גוגל לבעלי-אתרים', variants: ['סרצ׳ קונסול', 'סירץ׳ קונסול'] },
]

const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

// נרמול דטרמיניסטי: מחליף כל variant ב-canonical (כולל צורות מוטות כמו בשופייפיי→בשופיפיי).
// מחזיר { md, changes:[{from,to,count}] }.
export function normalizeBrands(md) {
  let out = md
  const changes = []
  for (const b of BRANDS) {
    for (const v of b.variants || []) {
      if (!v || v === b.canonical) continue
      const re = new RegExp(esc(v), 'g')
      const n = (out.match(re) || []).length
      if (n) { out = out.replace(re, b.canonical); changes.push({ from: v, to: b.canonical, count: n }) }
    }
  }
  return { md: out, changes }
}

// טקסט-גלוסר למגיה ה-LLM: אוכף איות + מתריע על בלבול פלטפורמה/מנוע (סמנטי).
export function glossaryForPrompt() {
  const lines = BRANDS.map((b) => {
    const conf = b.confusable ? `  ⚠ אל תבלבל עם: ${b.confusable}` : ''
    return `- ${b.en} = "${b.canonical}"${b.note ? ` — ${b.note}` : ''}${conf}`
  })
  return `פלטפורמות/מותגים לועזיים — איות עברי תקני (אכוף בדיוק; שים לב לבלבול בין מנוע-חיפוש למנוע-תשובות):\n${lines.join('\n')}\nאם מופיע מותג באיות שונה, או בלבול בין שני מותגים/מונחים קרובים — דווח issue עם התיקון המדויק, כולל אם זה בכותרת.`
}
