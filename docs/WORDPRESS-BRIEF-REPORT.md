# Report back to the `scayla-wp/` lane

**Date:** 2026-08-04 · **From:** the website lane (`~/Downloads/Claude/scayla/`)
**Brief:** `SCAYLA_WEB_WORDPRESS_BRIEF.md`
**Status: all five deliverables are live on scayla.co.il.** Commits `096c4d6` + `169eea1`.

Nothing in `scayla-wp/` or `rankpilot/` was touched.

---

## 1. Exact URL of the WordPress page

```
https://scayla.co.il/wordpress
```

**The path you assumed is the path I built.** No change needed to the plugin's `Plugin URI`
header. It is linked from the main site navigation (desktop and mobile) as "WordPress",
so a reviewer reaches it from the homepage in one click.

## 2. Exact URLs of Terms and Privacy

| Document | Hebrew (binding) | English |
|---|---|---|
| Terms of Service | `https://scayla.co.il/terms` | `https://scayla.co.il/en/terms` |
| Privacy Policy | `https://scayla.co.il/privacy` | `https://scayla.co.il/en/privacy` |

All four return 200. Reciprocal `hreflang` is emitted on every one of them, with
`x-default` pointing at the Hebrew version, and each page carries a visible language
switcher. The English pages state in their first paragraph that the Hebrew text is the
legally binding one, so the translation cannot be read as a second, conflicting contract.

**For the plugin readme, the privacy anchor a reviewer wants is section 3.5:**
`https://scayla.co.il/privacy` → "3.5 נתוני האתר ב-WordPress / WooCommerce", or the
English equivalent at `https://scayla.co.il/en/privacy`.

## 3. Which CTA shape I built

**The interim shape (§B option 2), because the portal is not live yet.**

- The CTA reads **"התקנה לוורדפרס"** and appears twice: in the hero and again at the
  bottom of the page.
- It leads to a real signup section on the same page (`/wordpress#signup`) with a working
  form: site address, email, optional name.
- It POSTs to a new Cloudflare Pages Function, **`/api/wp-signup`**, which validates and
  normalises the site URL, blocks bots with a honeypot, and writes the signup to **two
  independent sinks** (a Google Sheet and a Telegram alert) so a failure on one side never
  loses a signup. Verified end-to-end against production: a real submission returns
  `{"ok":true}`, an invalid email returns a field error, the honeypot silently passes.
- There is **no "coming soon" and no waitlist anywhere on the page.** A reviewer who
  clicks gets a form, fills it, and gets a confirmation message telling them the install
  link and pairing instructions are coming by email.

**What I need from you when the portal is live:** send me the portal URL. Switching to
the preferred shape (§B option 1) is then a one-line change — the two CTA `href`s move
from `#signup` to the portal, and the signup section comes out. The Function can stay as a
fallback or be removed, your call.

**One test row exists.** I submitted `example-wp-test.co.il` / `lior+wptest@mrmake.co.il`
with the name "בדיקת מערכת" to prove the pipeline. Delete it when convenient.

## 4. Anything from §3 I could not say

Nothing was dropped for lack of material — all four capability blocks are on the page, and
the read-back verification story (§3.3) got its own card with the `wp_yoast_indexable`
detail spelled out, because you were right that it is the most persuasive thing there.

Three deliberate choices you should know about:

1. **The honesty guardrails are stated on the page, not just respected.** There is a card
   in the Hebrew/RTL section titled "ומה לא נטען כאן" that says plainly: we do not claim
   better Hebrew content analysis than Yoast or Rank Math, we did not invent AI-visibility
   tracking, and we are not the only vendor that measures and writes back. A reviewer
   comparing the page to the readme finds the page *under*-claiming, which is the safe
   direction. There is also a FAQ entry answering "are you the only ones who measure AI
   visibility?" with "no", naming Yoast, Rank Math and AIOSEO.

2. **No price is published.** §6 said not to publish a number that has no working checkout.
   Since Paddle is Phase 4 and the CTA is a signup rather than a checkout, I chose not to
   print `$39` on the page. The pricing section says the plugin is free under GPL, that
   payment is for the cloud service only, that the plans open together with the plugin, and
   that the exact price arrives before any commitment. **If you want the ladder published,
   tell me and it is a five-minute edit** — I just did not want the first thing a reviewer
   sees to be a number they cannot pay.

3. **Terms describe the billing mechanism generically.** Section 8.2 says billing goes
   through an external payment provider acting as **Merchant of Record** that issues the
   invoice and handles applicable taxes. Paddle is not named, so nothing becomes false if
   the provider changes. Shopify billing stays accurate in 8.1, and cancellation for both
   platforms is in 8.4.

## 5. What changed in the legal documents

**Privacy** — the "intended only for Shopify store owners" scoping is gone. New **section
3.5** reproduces your disclosure faithfully: the three phases (pairing / while operating /
health check) with every field listed, the fact that the site stores only a SHA-256 hash of
the token, the explicit "what never leaves the site" list (visitor data, IPs, analytics,
tracking beacons, orders, customers, user accounts and emails, and no host other than
Scayla), and the no-outbound-requests paragraph quoted as a blockquote. Deletion and
disconnection are documented per platform, including the point that disconnection is done
from the site side and does not depend on us. Cookies section notes the plugin sets none
and loads no script or stylesheet.

**Terms** — the plugin is now a defined term (1.3), installation from wordpress.org is its
own clause (4.2) separate from the Shopify app store (4.1), the GPL/nothing-is-locked
position is stated (4.3), WordPress billing is 8.2, cancellation for both platforms is 8.4,
and the third-party and liability clauses now name WordPress.org, WooCommerce, and
third-party SEO plugins.

## 6. Loose ends on my side

- `wp-api.scayla.co.il` is named in the privacy policy as the WordPress-facing interface.
  It still does not resolve. That is fine for a reviewer reading a policy, but if you would
  rather it not appear before it is live, say so and I will remove the mention.
- The signup Function writes to a "WordPress" tab in the existing leads sheet and creates
  the tab on first use. If you would rather it went somewhere else, it is one env var.
