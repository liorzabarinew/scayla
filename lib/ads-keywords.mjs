// lib/ads-keywords.mjs — real monthly search volumes from Google Ads.
//
// ONE service is called: KeywordPlanIdeaService.GenerateKeywordIdeas. Nothing
// else. This is not a style preference, it is the scope Google was told about in
// the Basic Access application on 9.8.26, and it is the scope the manager
// account's client accounts are safe under.
//
// HARD RULE — manager account 300-730-6828 holds ~13 LIVE client accounts with
// real spend. This module is read-only and must stay read-only. It never
// creates, edits, pauses or deletes anything. Widening what it touches needs
// Lior's explicit approval, not a judgement call.
//
// Until Basic Access is granted the token is at "Test Account" level and cannot
// read production accounts. Every failure here is swallowed and reported as
// "no data", because lib/demand.mjs falls back to Google autocomplete and the
// content pipeline must never break over a data source that is merely nicer.
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = join(here, '..', '.cache', 'ads-volumes.json');
const CACHE_TTL_MS = 30 * 24 * 60 * 60 * 1000;

// v25 as of 11.8.26. Verified live: v21 and below answer
// "Version vNN is deprecated. Requests to this version will be blocked."
// Google retires versions roughly every four months, so when every call starts
// failing with UNSUPPORTED_VERSION, bump this and nothing else.
const API_VERSION = 'v25';
const LOGIN_CUSTOMER_ID = (process.env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || '3007306828').replace(/\D/g, '');
// Resolved lazily: it lives in Secret Manager like everything else, and reading
// only the environment meant a stored customer id was invisible to the module.
let _customerId = null;
async function customerId() {
  if (_customerId !== null) return _customerId;
  const v = await secret('GOOGLE_ADS_CUSTOMER_ID');
  _customerId = String(v || '').replace(/\D/g, '');
  return _customerId;
}

// Geo target constants and language constants are stable Google IDs.
const GEO = { IL: '2376', US: '2840' };
const LANG = { he: '1027', en: '1000' };

const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

let _cache = null;
function cache() {
  if (_cache) return _cache;
  try { _cache = JSON.parse(readFileSync(CACHE_FILE, 'utf8')); } catch { _cache = {}; }
  return _cache;
}
function saveCache() {
  try {
    mkdirSync(dirname(CACHE_FILE), { recursive: true });
    writeFileSync(CACHE_FILE, JSON.stringify(_cache || {}, null, 1));
  } catch { /* best effort */ }
}

/**
 * Read a secret: environment, then Secret Manager, then the gcloud CLI.
 *
 * The CLI fallback exists because the client library needs Application Default
 * Credentials, which a laptop shell does not have even when `gcloud` itself is
 * logged in. Without it, every local run reported "no developer token" while the
 * secret was sitting in Secret Manager, correct and verified.
 */
// חמשת סודות ה-Ads הם משאב חוצה-ליינים: הם שייכים ל-MCC של ליאור, לא לאתר.
// הם יושבים ב-mrmake-seo-5836 כי שם הם נוצרו, וזה נשאר מקור האמת היחיד ·
// שכפול לפרויקט שני היה יוצר שני מקומות לסובב בהם טוקן, וזה נגמר תמיד באחד
// שנשכח. ב-Cloud Run הם מוזרקים כמשתני סביבה, ואז secret() לא נוגע בכלל
// ב-Secret Manager.
const PROJECT = process.env.ADS_SECRETS_PROJECT || process.env.GOOGLE_CLOUD_PROJECT || 'mrmake-seo-5836';
const _secretCache = new Map();
async function secret(name) {
  if (process.env[name]) return process.env[name];
  if (_secretCache.has(name)) return _secretCache.get(name);

  let value = null;
  try {
    const { SecretManagerServiceClient } = await import('@google-cloud/secret-manager');
    const client = new SecretManagerServiceClient();
    const [v] = await client.accessSecretVersion({ name: `projects/${PROJECT}/secrets/${name}/versions/latest` });
    value = v.payload.data.toString();
  } catch { /* fall through to the CLI */ }

  if (!value) {
    try {
      const { execFileSync } = await import('node:child_process');
      value = execFileSync(
        'gcloud',
        ['secrets', 'versions', 'access', 'latest', `--secret=${name}`, `--project=${PROJECT}`],
        { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] },
      ).trim();
    } catch { value = null; }
  }

  _secretCache.set(name, value);
  return value;
}

/** Exchange the stored refresh token for an access token. */
async function accessToken() {
  const [clientId, clientSecret, refresh] = await Promise.all([
    secret('GOOGLE_ADS_CLIENT_ID'),
    secret('GOOGLE_ADS_CLIENT_SECRET'),
    secret('GOOGLE_ADS_REFRESH_TOKEN'),
  ]);
  if (!clientId || !clientSecret || !refresh) return null;
  const r = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId, client_secret: clientSecret,
      refresh_token: refresh, grant_type: 'refresh_token',
    }),
  });
  if (!r.ok) return null;
  return (await r.json()).access_token || null;
}

/**
 * Is the API usable right now?
 * Reports why not, so an operator is never left guessing whether the token
 * arrived, the secret is missing, or the customer id was never set.
 *
 * @returns {Promise<{ready:boolean, reason:string}>}
 */
export async function adsReady() {
  const dev = await secret('GOOGLE_ADS_DEVELOPER_TOKEN');
  if (!dev) return { ready: false, reason: 'אין GOOGLE_ADS_DEVELOPER_TOKEN ב-Secret Manager' };
  const refresh = await secret('GOOGLE_ADS_REFRESH_TOKEN');
  if (!refresh) return { ready: false, reason: 'אין GOOGLE_ADS_REFRESH_TOKEN — צריך להריץ את זרימת ה-OAuth פעם אחת' };
  if (!(await customerId())) return { ready: false, reason: 'לא הוגדר GOOGLE_ADS_CUSTOMER_ID' };
  const tok = await accessToken();
  if (!tok) return { ready: false, reason: 'החלפת refresh token נכשלה' };
  return { ready: true, reason: 'מוכן' };
}

/**
 * Average monthly searches for a set of keywords.
 *
 * @param {string[]} keywords
 * @param {{market?: 'IL'|'US'}} opts
 * @returns {Promise<Map<string, number>>} empty map when the API is unavailable
 */
export async function keywordVolumes(keywords = [], { market = 'IL' } = {}) {
  const out = new Map();
  const wanted = [...new Set(keywords.map(norm).filter(Boolean))];
  if (!wanted.length) return out;

  // Serve from cache first — the Ads API has a daily operation budget and the
  // same seed terms are scored over and over as the queue is rebuilt.
  const c = cache();
  const misses = [];
  for (const k of wanted) {
    const hit = c[`${market}:${k}`];
    if (hit && Date.now() - hit.at < CACHE_TTL_MS) out.set(k, hit.volume);
    else misses.push(k);
  }
  if (!misses.length) return out;

  const dev = await secret('GOOGLE_ADS_DEVELOPER_TOKEN');
  const tok = await accessToken();
  const cust = await customerId();
  if (!dev || !tok || !cust) return out; // caller falls back; never throw

  // Batches of 10, not 20: the API answers DEADLINE_EXCEEDED on larger Hebrew
  // batches often enough to matter, and a failed batch used to be recorded as
  // "zero volume for every keyword in it" — a false zero that would then sit in
  // the cache for 30 days and reject good topics. Smaller batches, real retries,
  // and a zero is only ever written when the request actually succeeded.
  for (let i = 0; i < misses.length; i += 10) {
    const batch = misses.slice(i, i + 10);
    let ok = false;
    for (let attempt = 0; attempt < 3 && !ok; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 2000 * attempt));
    try {
      const r = await fetch(
        `https://googleads.googleapis.com/${API_VERSION}/customers/${cust}:generateKeywordIdeas`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tok}`,
            'developer-token': dev,
            'login-customer-id': LOGIN_CUSTOMER_ID,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            language: `languageConstants/${market === 'US' ? LANG.en : LANG.he}`,
            geoTargetConstants: [`geoTargetConstants/${market === 'US' ? GEO.US : GEO.IL}`],
            keywordPlanNetwork: 'GOOGLE_SEARCH',
            keywordSeed: { keywords: batch },
          }),
        },
      );
      if (!r.ok) {
        const body = (await r.text()).slice(0, 300);
        const transient = /DEADLINE_EXCEEDED|UNAVAILABLE|RESOURCE_EXHAUSTED|INTERNAL/i.test(body);
        console.warn(`[ads] ${r.status}${transient ? ' (חולף, מנסה שוב)' : ''}: ${body.slice(0, 160)}`);
        if (!transient) break; // a real rejection will not fix itself
        continue;              // retry the same batch
      }
      for (const row of (await r.json()).results || []) {
        const k = norm(row.text);
        const v = Number(row.keywordIdeaMetrics?.avgMonthlySearches ?? 0);
        out.set(k, v);
        c[`${market}:${k}`] = { at: Date.now(), volume: v };
      }
      // Only now, after a request that actually succeeded: a seed the API did
      // not return has no measurable volume, and that is a finding worth caching.
      for (const k of batch) {
        if (!out.has(k)) { out.set(k, 0); c[`${market}:${k}`] = { at: Date.now(), volume: 0 }; }
      }
      ok = true;
    } catch (e) {
      console.warn(`[ads] batch failed: ${e.message}`);
    }
    }
    if (!ok) console.warn(`[ads] ${batch.length} מילים לא נבדקו אחרי 3 ניסיונות — לא נרשם 0`);
  }
  saveCache();
  return out;
}

/** Keyword ideas around a seed, with volumes. Same single service, same read-only scope. */
export async function keywordIdeas(seeds = [], { market = 'IL', limit = 100 } = {}) {
  const dev = await secret('GOOGLE_ADS_DEVELOPER_TOKEN');
  const tok = await accessToken();
  const cust = await customerId();
  if (!dev || !tok || !cust) return [];
  try {
    const r = await fetch(
      `https://googleads.googleapis.com/${API_VERSION}/customers/${cust}:generateKeywordIdeas`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${tok}`,
          'developer-token': dev,
          'login-customer-id': LOGIN_CUSTOMER_ID,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          language: `languageConstants/${market === 'US' ? LANG.en : LANG.he}`,
          geoTargetConstants: [`geoTargetConstants/${market === 'US' ? GEO.US : GEO.IL}`],
          keywordPlanNetwork: 'GOOGLE_SEARCH',
          keywordSeed: { keywords: seeds.slice(0, 20) },
        }),
      },
    );
    if (!r.ok) return [];
    return ((await r.json()).results || [])
      .map((x) => ({
        keyword: norm(x.text),
        volume: Number(x.keywordIdeaMetrics?.avgMonthlySearches ?? 0),
        competition: x.keywordIdeaMetrics?.competition || null,
      }))
      .sort((a, b) => b.volume - a.volume)
      .slice(0, limit);
  } catch { return []; }
}
