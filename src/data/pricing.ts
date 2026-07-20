// Pricing tiers · single source of truth for /pricing.
// Growth $49 · Scale $69 · Max $99 / month · 14-day free trial ·
// free diagnosis · no permanent free plan · billed through Shopify.
//
// The tiers differ by 4 simple quantity axes, shown identically on every card
// so the difference is obvious at a glance:
// ניטור AI · מאמרים בחודש · מתחרים במעקב · מוצרים מנוטרים
// (First-draft numbers · the client refines later.)

// LIVE (Lior, 2026-07-18): the app is public on the Shopify App Store, so every
// "התקינו ב-Shopify" CTA site-wide points to the real listing. This is NOT a
// calendly.com link, so BaseLayout's Calendly popup interceptor leaves it alone
// and it navigates straight to the App Store.
export const SHOPIFY_APP_URL = 'https://apps.shopify.com/scayla';

// Annual billing · 20% off the monthly price (matches the Shopify app, re-added
// 2026-07-18). One knob: change ANNUAL_DISCOUNT and every price + badge updates.
// At 20% off: Growth $49→$39 · Scale $69→$55 · Max $99→$79 per month.
export const ANNUAL_DISCOUNT = 0.2;
/** % off, shown on the toggle + savings line (e.g. 20). */
export const ANNUAL_DISCOUNT_PCT = Math.round(ANNUAL_DISCOUNT * 100);
/** Effective per-month price when billed annually, rounded to a whole dollar. */
export const annualPerMonth = (price: number) => Math.round(price * (1 - ANNUAL_DISCOUNT));
/** Total charged once per year when billed annually, rounded to a whole dollar. */
export const annualTotal = (price: number) => Math.round(price * 12 * (1 - ANNUAL_DISCOUNT));

// The "קבעו דמו" destination · Lior's Calendly. Loaded site-wide (BaseLayout):
// clicking any demo CTA opens the Calendly popup; if the widget script hasn't
// loaded yet it falls back to opening this URL directly. One knob for every CTA.
export const DEMO_URL = 'https://calendly.com/lior-mrmake/30min';

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
      { label: 'מאמרים בחודש', value: '8', num: true },
      { label: 'מוצרים מנוטרים', value: '100', num: true },
      { label: 'מתחרים במעקב', value: '3', num: true },
      { label: 'ניטור AI', value: 'ChatGPT' },
    ],
    features: [],
  },
  {
    name: 'Scale',
    price: 69,
    tagline: 'למותג שרוצה להוביל את הקטגוריה.',
    popular: true,
    axes: [
      { label: 'מאמרים בחודש', value: '20', num: true },
      { label: 'מוצרים מנוטרים', value: '500', num: true },
      { label: 'מתחרים במעקב', value: '6', num: true },
      { label: 'ניטור AI', value: 'ChatGPT + Gemini' },
    ],
    features: [
      'FAQ אוטומטי לעמודי קטגוריה',
    ],
  },
  {
    name: 'Max',
    price: 99,
    tagline: 'לקטלוג גדול ולנפח גבוה.',
    axes: [
      { label: 'מאמרים בחודש', value: '40', num: true },
      { label: 'מוצרים מנוטרים', value: '2,000', num: true },
      { label: 'מתחרים במעקב', value: '12', num: true },
      { label: 'ניטור AI', value: 'ChatGPT + Gemini' },
    ],
    features: [
      'FAQ אוטומטי לעמודי קטגוריה',
      'תמיכת פרימיום',
    ],
  },
];
