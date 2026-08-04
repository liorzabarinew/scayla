# Report back to the `scayla-wp/` lane

**Date:** 2026-08-04 · **From:** the website lane (`~/Downloads/Claude/scayla/`)
**Brief:** `SCAYLA_WEB_WORDPRESS_BRIEF.md`
**Status: all five deliverables are live on scayla.co.il.** Commits `096c4d6` → `a74d179`.

Nothing in `scayla-wp/` or `rankpilot/` was touched.

> ⛔ **Read section 6 before submitting.** One item is on your side and can fail the
> review: `wp-api.scayla.co.il` is named in the privacy policy and does not resolve.

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

**Pipeline proven and cleaned up.** I submitted a test signup to verify the whole path,
confirmed the `WordPress` tab was auto-created with headers as designed, then deleted the
test row. The tab is clean.

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

2. **Pricing: published, and it is the same ladder as Shopify.** I first shipped the page
   with no number, per §6. Lior then decided not to maintain a second ladder, so
   `/wordpress` now renders the very same `PricingCards` component off the same
   `src/data/pricing.ts`: **Growth $49 · Scale $69 · Max $99**, with the monthly/annual
   toggle and 20% annual discount. A price edit happens in one file and both platforms
   follow. Worth noting for your side: the `$39` entry your brief decided on is exactly
   Growth billed annually ($49 − 20%), so the numbers agree rather than compete.
   The only difference from `/pricing` is the CTA, which points at the signup instead of
   the Shopify listing, and a note under the cards stating that WordPress billing does not
   go through Shopify and that nothing is charged without explicit approval.

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

## 6. ⛔ One thing you own that can fail the review

**`wp-api.scayla.co.il` does not resolve, and the privacy policy names it.**

I named it in section 1 of both the Hebrew and English privacy policies, as the
WordPress-facing interface, because that is what your brief described. Re-checked
2026-08-04: DNS still does not resolve (`scayla.co.il` and `app.scayla.co.il` both
return 200; this one returns nothing).

An earlier draft of this report called that "fine for a reviewer reading a policy".
That was wrong and I am correcting it. A reviewer verifying a data-disclosure document
may well try the host it names. A privacy policy that points at a domain which does not
exist is exactly the "unverifiable disclosure" failure mode your own brief warned about
in §1, and it sits in the document a reviewer reads first.

**Two ways to close it. Pick one and tell me:**

1. **You deploy it before submission.** Then the policy is already correct and I do
   nothing. Tell me when it is live and I will re-verify.
2. **I remove the mention now.** The policy stays complete and accurate without it —
   the domain is not required by any disclosure in section 3.5, it was context only.
   Adding it back later is a two-line edit.

**My recommendation is option 2**, purely on asymmetry: removing it costs nothing and
carries no risk, while keeping it is only correct if your deployment lands before a
reviewer looks. If I do not hear otherwise, I will remove it as the submission
approaches rather than leave it to timing.

## 7. Smaller notes

- The signup Function writes to a "WordPress" tab in the existing leads sheet and creates
  the tab on first use. If you would rather it went somewhere else, it is one env var.
- The test row I created to prove the pipeline has been deleted; the tab is clean.
