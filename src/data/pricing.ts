// Pricing tiers · single source of truth for /pricing.
// Growth $49 · Scale $69 · Max $99 / month · 14-day free trial ·
// free diagnosis · no permanent free plan · billed through Shopify.
//
// The tiers differ by 4 simple quantity axes, shown identically on every card
// so the difference is obvious at a glance:
// ניטור AI · מאמרים בחודש · מתחרים במעקב · מוצרים מנוטרים
// (First-draft numbers · the client refines later.)

// PLACEHOLDER: replace with the real Shopify App Store listing URL at launch.
export const SHOPIFY_APP_URL = '#shopify-app-store-placeholder';

// Annual billing · 20% off the monthly price (Lior's call, 2026-07-11). One knob:
// change ANNUAL_DISCOUNT and every price + badge on the card updates automatically.
export const ANNUAL_DISCOUNT = 0.2;
/** % off, shown on the toggle + savings line (e.g. 20). */
export const ANNUAL_DISCOUNT_PCT = Math.round(ANNUAL_DISCOUNT * 100);
/** Effective per-month price when billed annually, rounded to a whole dollar. */
export const annualPerMonth = (price: number) => Math.round(price * (1 - ANNUAL_DISCOUNT));
/** Total charged once per year when billed annually, rounded to a whole dollar. */
export const annualTotal = (price: number) => Math.round(price * 12 * (1 - ANNUAL_DISCOUNT));

// PLACEHOLDER: the "קבעו דמו" destination · a Google URL Noy will provide later
// (e.g. Google Calendar / Forms). Swap this one line to go live. Every "קבעו דמו"
// button across the site pulls from here; it opens in a new tab (target=_blank).
export const DEMO_URL = '#demo-placeholder';

export interface TierAxis {
  label: string;
  value: string;
  /** true → the value is numeric and gets LTR isolation via the .num class */
  num?: boolean;
}

export interface Tier {
  name: string;
  price: number;
  tagline: string;
  popular?: boolean;
  /** the 4 quantity axes · SAME labels, SAME order, on every tier */
  axes: TierAxis[];
  /** everything else that's included · kept short */
  features: string[];
}

export const tiers: Tier[] = [
  {
    name: 'Growth',
    price: 49,
    tagline: 'לחנות שרוצה להתחיל להופיע ב-AI.',
    axes: [
      { label: 'ניטור AI', value: 'שבועי' },
      { label: 'מאמרים בחודש', value: '8', num: true },
      { label: 'מתחרים במעקב', value: '3', num: true },
      { label: 'מוצרים מנוטרים', value: '100', num: true },
    ],
    features: [
      'צופה תשובות חי (ChatGPT)',
      'מתקן 404 + סכמות בסיס',
      'חיבור Google Search Console',
    ],
  },
  {
    name: 'Scale',
    price: 69,
    tagline: 'למותג שרוצה להוביל את הקטגוריה.',
    popular: true,
    axes: [
      { label: 'ניטור AI', value: 'פעמיים בשבוע' },
      { label: 'מאמרים בחודש', value: '20', num: true },
      { label: 'מתחרים במעקב', value: '6', num: true },
      { label: 'מוצרים מנוטרים', value: '500', num: true },
    ],
    features: [
      'כל מה שב-Growth',
      'מדידה רב-מנועית · ChatGPT + Gemini',
      'FAQ אוטומטי לעמודי מוצר',
      'חיבור GA4 + דוח ROI לפני ואחרי',
    ],
  },
  {
    name: 'Max',
    price: 99,
    tagline: 'לקטלוג גדול ולנפח גבוה.',
    axes: [
      { label: 'ניטור AI', value: 'יומי' },
      { label: 'מאמרים בחודש', value: '40', num: true },
      { label: 'מתחרים במעקב', value: '12', num: true },
      { label: 'מוצרים מנוטרים', value: '2,000', num: true },
    ],
    features: [
      'כל מה שב-Scale',
      'פעולות בכמות (Bulk) על כל הקטלוג',
      'דוחות מתקדמים + KPI מותאמים',
      'עדיפות בתמיכה',
    ],
  },
];
