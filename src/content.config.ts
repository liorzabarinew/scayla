import { defineCollection, z } from 'astro:content';
import { glob } from 'astro/loaders';

/**
 * Magazine posts collection · the site's own SEO play.
 * Content will be auto-fed by the Scayla content machine later ·
 * new posts = new .md files in src/content/magazine/ (Hebrew filenames = Hebrew slugs).
 *
 * Topic clusters (Noy · question 5) · the silo structure of the magazine:
 *  - "GEO ואופטימיזציה למנועי AI"
 *  - "SEO לחנויות שופיפיי"
 *  - "שיווק לאיקומרס ישראלי"
 *  - "מדריכים וכלים"
 */
export const CLUSTERS = [
  'GEO ואופטימיזציה למנועי AI',
  'SEO לחנויות שופיפיי',
  'שיווק לאיקומרס ישראלי',
  'מדריכים וכלים',
] as const;

/**
 * Clean, hyphenated URL slugs per cluster · keeps /magazine/cluster/<slug>
 * free of %20-encoded Hebrew. Namespaced under /magazine/cluster so
 * "seo-shopify" here does not clash with the top-level /seo-shopify page.
 */
export const CLUSTER_SLUGS: Record<(typeof CLUSTERS)[number], string> = {
  'GEO ואופטימיזציה למנועי AI': 'geo-ai',
  'SEO לחנויות שופיפיי': 'seo-shopify',
  'שיווק לאיקומרס ישראלי': 'ecommerce',
  'מדריכים וכלים': 'guides',
};

/** slug → cluster name (reverse lookup for getStaticPaths / links). */
export const SLUG_TO_CLUSTER = Object.fromEntries(
  Object.entries(CLUSTER_SLUGS).map(([cluster, slug]) => [slug, cluster])
) as Record<string, (typeof CLUSTERS)[number]>;

/** Build the clean cluster archive path for a cluster name. */
export const clusterPath = (cluster: (typeof CLUSTERS)[number]) =>
  `/magazine/cluster/${CLUSTER_SLUGS[cluster]}`;

const magazine = defineCollection({
  loader: glob({ pattern: '**/*.md', base: './src/content/magazine' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    pubDate: z.coerce.date(),
    cluster: z.enum(CLUSTERS),
    readingMinutes: z.number().default(5),
    demo: z.boolean().default(false),
    /** Content machine · bank model. draft:true = written to the bank, not yet dripped live. */
    draft: z.boolean().default(false),
    /** Content machine · a QA/dup gate held this for a human glance. Excluded from listings until released. */
    needsReview: z.boolean().default(false),
    /** Content machine · resolved research sources (E-E-A-T), rendered at the article foot. */
    sources: z.array(z.object({ title: z.string(), url: z.string() })).optional(),
    /** Human author (E-E-A-T). When set, the post shows a byline linking to /experts. */
    author: z.string().optional(),
    /** Last substantive update · powers dateModified in the Article schema. */
    updatedDate: z.coerce.date().optional(),
    /** Cover image · absolute path under /public or a full URL. */
    coverImage: z.string().optional(),
    /** Short TL;DR bullets · rendered as the "מה תלמדו" box at the top. */
    takeaways: z.array(z.string()).optional(),
    /** Per-post FAQ · rendered via FaqAccordion + FAQPage JSON-LD. */
    faq: z.array(z.object({ q: z.string(), a: z.string() })).optional(),
  }),
});

export const collections = { magazine };
