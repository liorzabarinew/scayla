// lib/demand.mjs — does anyone actually search for this?
//
// The machine published 164 articles that produced 2,719 impressions and 5 clicks
// in 90 days. The cause was not quality and not technique: topics were generated
// by a language model with nothing checking that the phrase is one Israelis type.
// Of 182 queued topics, 147 returned zero Google autocomplete suggestions in
// Hebrew. Not one article targeted "בניית אתר לעסק" (1,000 searches/month) or
// "אוטומציה לעסקים" (590/month, +85% year on year).
//
// This module is the gate that stops that from happening again.
//
// Two sources, same interface:
//   1. Google Ads Keyword Planner — real monthly volumes. Needs Basic Access on
//      the developer token, applied for 9.8.26, under review.
//   2. Google autocomplete — free, no approval, and a good discriminator: terms
//      nobody types return 0-2 completions, real terms return 9-10.
//
// Callers ask hasDemand() and never care which source answered. When Basic
// Access lands, adsVolumes() starts returning numbers and the gate sharpens
// without a single caller changing.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CACHE_DIR = join(here, '..', '.cache');
const CACHE_FILE = join(CACHE_DIR, 'demand.json');

// A month. Search volume does not move fast enough to justify asking again, and
// the Ads API has a daily operation budget worth protecting.
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

let _cache = null;
function cache() {
  if (_cache) return _cache;
  try { _cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { _cache = {}; }
  return _cache;
}
function saveCache() {
  try {
    mkdirSync(CACHE_DIR, { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(_cache || {}, null, 1));
  } catch { /* cache is an optimisation, never a dependency */ }
}

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

// ── source 1: Google autocomplete ───────────────────────────────────────────

/**
 * How many completions Google offers for a phrase, in Hebrew, for Israel.
 *
 * This is a proxy for demand, not a measurement. It earns its place by being a
 * clean discriminator: measured against terms with known volume, phrases nobody
 * searches return 0-2 and real ones return 9-10. It needs no approval and no
 * credential, which is why the machine is not blocked on Google's review.
 *
 * @returns {Promise<number>} completion count, or -1 if the request failed
 */
export async function autocompleteDepth(term, { hl = 'iw', gl = 'il', timeoutMs = 8000 } = {}) {
  const q = norm(term);
  if (!q) return 0;
  const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=${hl}&gl=${gl}&q=${encodeURIComponent(q)}`;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' }, signal: ctl.signal });
    if (!r.ok) return -1;
    const body = await r.text();
    const parsed = JSON.parse(body);
    return Array.isArray(parsed?.[1]) ? parsed[1].length : 0;
  } catch { return -1; } finally { clearTimeout(t); }
}

/**
 * The phrases people actually type around a seed.
 *
 * Autocomplete answers "what do people type that starts this way", so appending
 * each Hebrew letter harvests the real long tail instead of inventing it. This
 * is where new topics should come from: observed queries, not model guesses.
 *
 * @returns {Promise<string[]>} distinct suggestions, longest tail first
 */
export async function expandSeed(seed, { letters = 'אבגדהוזחטיכלמנסעפצקרשת', max = 60, concurrency = 6 } = {}) {
  const base = norm(seed);
  if (!base) return [];
  const probes = ['', ...String(letters).split('')].map((L) => (L ? `${base} ${L}` : base));
  const found = new Set();
  for (let i = 0; i < probes.length; i += concurrency) {
    const batch = probes.slice(i, i + concurrency);
    const results = await Promise.all(batch.map(async (p) => {
      const url = `https://suggestqueries.google.com/complete/search?client=firefox&hl=iw&gl=il&q=${encodeURIComponent(p)}`;
      try {
        const r = await fetch(url, { headers: { 'User-Agent': 'Mozilla/5.0' } });
        return JSON.parse(await r.text())?.[1] || [];
      } catch { return []; }
    }));
    for (const list of results) for (const s of list) found.add(norm(s));
    if (found.size >= max) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  return [...found].filter((s) => s && s !== base).slice(0, max);
}

// ── source 2: Google Ads Keyword Planner (when access exists) ────────────────

/**
 * Real monthly search volumes, if the Ads API is reachable.
 *
 * Kept behind a dynamic import and a try/catch on purpose: until Basic Access is
 * granted the module may not even be configured, and a content pipeline must not
 * fail because a nice-to-have data source is missing.
 *
 * @returns {Promise<Map<string, number>|null>} keyword → avg monthly searches, or null
 */
export async function adsVolumes(keywords = []) {
  if (!keywords.length) return null;
  try {
    const mod = await import('./ads-keywords.mjs');
    if (typeof mod.keywordVolumes !== 'function') return null;
    const out = await mod.keywordVolumes(keywords);
    return out && out.size ? out : null;
  } catch { return null; }
}

// ── the gate ────────────────────────────────────────────────────────────────

/**
 * Demand for one keyword, from the best source currently available.
 *
 * @returns {Promise<{keyword:string, source:'ads'|'autocomplete'|'unknown',
 *                    volume:number|null, depth:number|null, score:number}>}
 *   score is 0-100 and comparable across sources.
 */
export async function demandFor(keyword, { fresh = false } = {}) {
  const key = norm(keyword);
  const c = cache();
  if (!fresh && c[key] && Date.now() - c[key].at < CACHE_TTL_MS) return { ...c[key].value, cached: true };

  let value;
  const vols = await adsVolumes([key]);
  const vol = vols ? vols.get(key) : undefined;

  if (typeof vol === 'number') {
    // 500+/month is a head term for this market; 10/month is noise.
    const score = vol <= 0 ? 0 : Math.min(100, Math.round(20 * Math.log10(vol + 1) * 1.6));
    value = { keyword: key, source: 'ads', volume: vol, depth: null, score };
  } else {
    const depth = await autocompleteDepth(key);
    if (depth < 0) {
      value = { keyword: key, source: 'unknown', volume: null, depth: null, score: 0 };
    } else {
      // 10 completions is Google's cap, so it saturates rather than scaling.
      value = { keyword: key, source: 'autocomplete', volume: null, depth, score: Math.round((Math.min(depth, 10) / 10) * 100) };
    }
  }

  c[key] = { at: Date.now(), value };
  saveCache();
  return value;
}

/** Score many keywords, gently enough not to get rate limited. */
export async function demandForAll(keywords = [], { concurrency = 6, pauseMs = 250, log } = {}) {
  const out = [];
  const list = [...new Set(keywords.map(norm).filter(Boolean))];
  for (let i = 0; i < list.length; i += concurrency) {
    out.push(...await Promise.all(list.slice(i, i + concurrency).map((k) => demandFor(k))));
    if (log) log(`  ${Math.min(i + concurrency, list.length)}/${list.length}`);
    if (i + concurrency < list.length) await new Promise((r) => setTimeout(r, pauseMs));
  }
  return out;
}

// Thresholds. MIN_SCORE 30 = at least 3 of 10 completions, which measured cleanly
// against terms with known volume. MIN_ADS_VOLUME 50 is the point below which an
// article cannot repay the cost of writing it.
export const MIN_SCORE = Number(process.env.MIN_DEMAND_SCORE || 30);
export const MIN_ADS_VOLUME = Number(process.env.MIN_ADS_VOLUME || 50);

/**
 * The gate itself. A topic that fails this does not get written.
 *
 * A source of 'unknown' fails closed: if we could not check, we do not publish.
 * Publishing on an unverified guess is exactly how the site ended up with 164
 * articles and 5 clicks.
 *
 * @returns {Promise<{ok:boolean, reason:string, demand:object}>}
 */
export async function hasDemand(keyword, { minScore = MIN_SCORE, minVolume = MIN_ADS_VOLUME } = {}) {
  const d = await demandFor(keyword);
  if (d.source === 'ads') {
    return d.volume >= minVolume
      ? { ok: true, reason: `${d.volume} חיפושים בחודש`, demand: d }
      : { ok: false, reason: `רק ${d.volume} חיפושים בחודש`, demand: d };
  }
  if (d.source === 'autocomplete') {
    return d.score >= minScore
      ? { ok: true, reason: `${d.depth} השלמות בגוגל`, demand: d }
      : { ok: false, reason: `${d.depth} השלמות בלבד — אין ביקוש`, demand: d };
  }
  return { ok: false, reason: 'לא ניתן היה לבדוק ביקוש', demand: d };
}
