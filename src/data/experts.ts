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
    latin: 'Lior Zabari',
    role: 'שיווק ביצועים וטכנולוגיה',
    roleLong: '15 שנה של ביצועים, מקודדים למכונה אחת.',
    years: 15,
    yearsLabel: '15 שנות ניסיון בשיווק דיגיטלי',
    cardBio:
      '15 שנה בשיווק ביצועים ותקציבי מדיה של מיליוני דולרים, שקידד למכונה: אוטומציות שיווק עם יותר ממיליון שיחות בוט. שותף רשמי של Google ו-Apple, ואחראי על המנוע הטכני של Scayla.',
    bio: [
      'מגיע עם ניסיון של 15 שנה בשיווק, תקציבי מדיה של מיליוני דולרים, וכלל אחד שמעולם לא זז אצלו: מה שלא נמדד, לא קרה.',
      'ליאור צברי הריץ קמפיינים לארגונים גדולים בתיירות, ב-Fintech ובטכנולוגיה, והקים צוותי שיווק מאפס. שותף רשמי של Google ו-Apple. אבל בשנים האחרונות הוא עשה את הצעד שמעטים עושים: לקח את כל הניסיון הזה וקידד אותו למכונה. אוטומציות שיווק ב-Scale.',
      'זה בדיוק ה-DNA שהוא הביא ל-Scayla. כאן ליאור אחראי על המנוע הטכני, האוטומציה שמריצה מדידה, אבחון ותיקון בקנה מידה, בלי שיד אנושית תצטרך לגעת בכל חנות בנפרד. פותר בעיות בנשמה, ואובססיבי לתוצאה שאפשר להראות בגרף.',
    ],
    bioShort:
      'שיווק ביצועים וטכנולוגיה עם 15 שנות ניסיון · שותף רשמי של Google ו-Apple.',
    tags: ['Performance Marketing', 'אוטומציה', 'טכנולוגיה', 'Scale מוכח'],
    expertise: [
      { title: 'Performance Marketing', text: 'תקציבי מדיה של מיליוני דולרים לארגונים גדולים · תיירות, Fintech וטכנולוגיה · לפי המספרים, לא לפי התחושה.' },
      { title: 'אוטומציה', text: 'אוטומציות שיווק בקנה מידה · יותר ממיליון שיחות בוט שרצות לבד.' },
      { title: 'טכנולוגיה', text: 'המנוע הטכני של Scayla · מדידה, אבחון ותיקון אוטומטיים, בלי יד אנושית בכל חנות.' },
      { title: 'Scale מוכח', text: '15 שנה של מערכות שיווק שעובדות לבד · הקמת צוותים מאפס · שותף רשמי של Google ו-Apple.' },
    ],
    brands: ['Google Partner', 'Apple Partner'],
    credentials: [],
    links: [
      { label: 'mrmake.co.il', href: 'https://mrmake.co.il/' },
      { label: 'LinkedIn', href: 'https://www.linkedin.com/in/lior-zabari/' },
    ],
    knowsAbout: [
      'Performance Marketing',
      'Marketing Automation',
      'Paid Media',
      'MarTech',
      'Conversion Optimization',
    ],
    sameAs: ['https://mrmake.co.il/', 'https://www.linkedin.com/in/lior-zabari/'],
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
