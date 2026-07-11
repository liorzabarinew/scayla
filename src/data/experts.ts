/**
 * Experts · the humans behind Scayla (E-E-A-T source of truth).
 *
 * Used by:
 *  - /experts (hub · two profile cards)
 *  - /experts/[slug] (one full individual profile per person · stronger E-E-A-T)
 *  - magazine post bylines + Article Person-author schema (via AUTHOR_BY_NAME)
 *
 * Copy is human Hebrew (anti-AI rules): short specific sentences, "·" not em-dash,
 * no "פתרון חדשני / חוויה / מוביל בתחום", no "למעשה / בעצם / חשוב לציין".
 */

export interface ExpertLink {
  label: string;
  href: string;
  placeholder?: boolean;
}

export interface ExpertCredential {
  label: string; // e.g. "תואר בתקשורת"
  from: string; // e.g. "האוניברסיטה הפתוחה"
}

export interface Expert {
  slug: string; // URL segment · /experts/<slug>
  initial: string; // avatar letter (fallback when no photo)
  /** Real headshot · path under /public (e.g. /experts/lior-zabari.jpg). Omit → gradient-initial avatar. */
  photo?: string;
  name: string;
  latin: string;
  role: string; // short role, used in bylines
  roleLong: string; // fuller role on the profile hero
  years: number; // years of experience
  yearsLabel: string; // human phrasing, e.g. "11 שנות ניסיון"
  /** Card blurb · used on the hub. */
  cardBio: string;
  /** Full bio paragraphs · used on the individual profile page. */
  bio: string[];
  /** One-line short bio · used under the byline on posts. */
  bioShort: string;
  tags: string[];
  /** Expertise areas (title + one line) for the profile page. */
  expertise: { title: string; text: string }[];
  /** Notable brands / proof points. */
  brands?: string[];
  /** Education & credentials · surfaced as a "השכלה והסמכות" line + JSON-LD. */
  credentials: ExpertCredential[];
  links: ExpertLink[];
  knowsAbout: string[];
  sameAs: string[];
  /** Accent for the profile top-line gradient. */
  accent: 'indigo' | 'gold';
}

export const experts: Expert[] = [
  {
    slug: 'noy-keitel',
    initial: 'נ',
    photo: '/experts/noy-keitel.jpg',
    name: 'נוי קייטל',
    latin: 'Noy Keitel',
    role: 'מומחית SEO ו-GEO',
    roleLong: 'מומחית SEO ו-GEO · שיווק מבוסס-AI',
    years: 11,
    yearsLabel: '11 שנות ניסיון',
    cardBio:
      'מקדמת מותגים ישראליים בגוגל כבר 11 שנה, והיום גם בתשובות של ה-AI. ליוותה 30+ עסקים, קידמה מותגים כמו Toys R Us, מגזין Femina ו-Mustela, ומלמדת SEO כמרצה ומנטורית.',
    bio: [
      'נוי קייטל מקדמת מותגים ישראליים כבר 11 שנה · בגוגל, והיום גם בתשובות של מנועי ה-AI. היא ליוותה יותר מ-30 עסקים בקידום אורגני ובבניית סמכות בתחום, וראתה מקרוב מה מדרג תוכן עברי · וגם מה גורם למנוע לצטט אותו.',
      'בין המותגים שקידמה: Toys R Us, מגזין Femina ו-Mustela, לצד חנויות איקומרס ישראליות. במקביל היא מלמדת SEO כמרצה ומנטורית, ומהראשונות בישראל שהתמחו ב-GEO · האופטימיזציה למנועי התשובות של ה-AI.',
      'ב-Scayla נוי בונה את המתודולוגיה שמזינה את המכונה: מה למדוד, מה לכתוב, ואיך מנצחים תשובה של AI · ולא רק מדרגים עמוד.',
    ],
    bioShort:
      'מומחית SEO ו-GEO עם 11 שנות ניסיון · קידמה מותגים כמו Toys R Us, Femina ו-Mustela.',
    tags: ['קידום אורגני', 'GEO', 'שיווק מבוסס-AI', 'תוכן'],
    expertise: [
      { title: 'קידום אורגני (SEO)', text: '11 שנות קידום מותגים וחנויות בגוגל · ממבנה אתר ועד תוכן שמדרג.' },
      { title: 'GEO', text: 'אופטימיזציה לתשובות של ChatGPT, Gemini ו-Perplexity · מהראשונות בישראל בתחום.' },
      { title: 'תוכן שמצוטט', text: 'כתיבה בעברית תקנית שמנועי AI אוהבים לצטט · תשובות ישירות, נתונים מובנים, סמכות.' },
      { title: 'הדרכה', text: 'מרצה ומנטורית ל-SEO · מלמדת עסקים ואנשי שיווק את מה שבאמת עובד.' },
    ],
    brands: ['Toys R Us', 'מגזין Femina', 'Mustela'],
    credentials: [
      { label: 'תואר בתקשורת', from: 'האוניברסיטה הפתוחה' },
      { label: 'תעודת שיווק דיגיטלי', from: 'HackerU (האקריו)' },
    ],
    links: [
      { label: 'busymom.co.il', href: 'https://busymom.co.il' },
      { label: 'LinkedIn', href: 'https://www.linkedin.com/', placeholder: true },
    ],
    knowsAbout: [
      'SEO',
      'Generative Engine Optimization',
      'AI Marketing',
      'Content Strategy',
      'E-commerce SEO',
    ],
    sameAs: ['https://busymom.co.il/'],
    accent: 'indigo',
  },
  {
    slug: 'lior-zabari',
    initial: 'ל',
    photo: '/experts/lior-zabari.jpg',
    name: 'ליאור צברי',
    latin: 'Lior Tzabari',
    role: 'שיווק ביצועים וטכנולוגיה',
    roleLong: 'שיווק ביצועים וטכנולוגיה · Mr. Make',
    years: 15,
    yearsLabel: '15 שנות ניסיון בשיווק דיגיטלי',
    cardBio:
      '15 שנות שיווק דיגיטלי וביצועים, ניהול תקציבי מדיה של מיליון דולר ומעלה, וקמפיינים לתאגידים. שותף רשמי של Google ו-Apple, ובנה אוטומציה של מעל מיליון שיחות בוט.',
    bio: [
      'ליאור צברי עוסק בשיווק דיגיטלי וביצועים כבר 15 שנה. הוא ניהל תקציבי מדיה של מיליון דולר ומעלה, והריץ קמפיינים לתאגידים גדולים · עם דגש על מספרים, לא על תחושות.',
      'הוא שותף רשמי של Google ו-Apple, ובשנים האחרונות בונה אוטומציות שיווק בקנה מידה · יותר ממיליון שיחות בוט. את הצד הזה בדיוק הוא מביא ל-Scayla: ה-DNA של מכונה שעובדת לבד ומדווחת במספרים.',
      'ב-Scayla ליאור אחראי על המנוע הטכני · האוטומציה שמריצה את המדידה, האבחון והתיקון בקנה מידה, בלי שצוות אנושי יצטרך לגעת בכל חנות ידנית.',
    ],
    bioShort:
      'שיווק ביצועים וטכנולוגיה עם 15 שנות ניסיון · שותף רשמי של Google ו-Apple.',
    tags: ['מדיה בתשלום', 'אוטומציה', 'טכנולוגיה', 'קנה מידה'],
    expertise: [
      { title: 'מדיה בתשלום', text: 'ניהול תקציבי מדיה של מיליון דולר ומעלה · קמפיינים לתאגידים.' },
      { title: 'אוטומציה', text: 'בניית אוטומציות שיווק בקנה מידה · יותר ממיליון שיחות בוט.' },
      { title: 'טכנולוגיה', text: 'המנוע הטכני שמריץ את המדידה, האבחון והתיקון של Scayla.' },
      { title: 'קנה מידה', text: '15 שנות ניסיון בהרצת מערכות שיווק שעובדות לבד · ומדווחות במספרים.' },
    ],
    brands: ['Google Partner', 'Apple Partner'],
    credentials: [
      { label: 'לימודי שיווק דיגיטלי', from: 'בית ספר לשיווק דיגיטלי · נמל תל אביב' },
    ],
    links: [
      { label: 'mrmake.co.il', href: 'https://mrmake.co.il/' },
      { label: 'LinkedIn', href: 'https://www.linkedin.com/', placeholder: true },
    ],
    knowsAbout: [
      'Performance Marketing',
      'Marketing Automation',
      'Paid Media',
      'MarTech',
      'Conversion Optimization',
    ],
    sameAs: ['https://mrmake.co.il/'],
    accent: 'gold',
  },
];

/**
 * Team proof · shared across expert profiles. Framing: these speak about the TEAM
 * behind Scayla (real client work), not the app (it is new) · per the social-proof rule.
 * Testimonials approved by Noy (source: ai.busymom.co.il).
 */
export const TEAM_STATS: { value: string; label: string }[] = [
  { value: '+30', label: 'עסקים בליווי' },
  { value: '4', label: 'מנועי AI' },
  { value: '+15', label: 'שנות שיווק' },
];

export const TEAM_TESTIMONIALS: { text: string; name: string; role: string }[] = [
  { text: 'אין מדהימה כמוך! הכי שירותית, סבלנית, התוצאות שהבאת לאתר שלנו מטורפות.', name: 'סנדרה תמרוב', role: 'מנהלת שיווק, Mutztzim' },
  { text: 'סופר מקצועית. נוי עובדת איתי כבר כמה שנים, סופר מקצועית ואחראית.', name: 'שי זלוה', role: 'בעלים, StarGet' },
  { text: 'את מעולה. מכל הבחינות · השירות, החיוך, המקצועיות.', name: 'ענת מבורך', role: 'מנהלת שיווק, באר בר' },
];

/** Lookup by exact author name (as written in post frontmatter). */
export const AUTHOR_BY_NAME: Record<string, Expert> = Object.fromEntries(
  experts.map((e) => [e.name, e])
);

/**
 * Compact byline map · what a post byline needs.
 * author name → { name, role, url, bioShort, initial }
 */
export const authorMap: Record<
  string,
  { name: string; role: string; url: string; bioShort: string; initial: string }
> = Object.fromEntries(
  experts.map((e) => [
    e.name,
    {
      name: e.name,
      role: e.role,
      url: `/experts/${e.slug}`,
      bioShort: e.bioShort,
      initial: e.initial,
    },
  ])
);
