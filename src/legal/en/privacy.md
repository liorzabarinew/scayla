Last updated: 4 August 2026

This is an English translation provided for convenience. The Hebrew version at [scayla.co.il/privacy](/privacy) is the legally binding text under Israeli law.

Scayla is a business (B2B) tool for online store owners. It is not intended for children.

## 1. Who we are, and who controls the data
Scayla is an SEO/GEO system for online stores. Its purpose is to make a store visible and recommended in Google Search and in AI answer engines (ChatGPT, Gemini, Perplexity, Claude).

The service supports two platforms, and the way each connects is different:

- **Shopify** — an application embedded in the store's admin (app.scayla.co.il, inside Shopify Admin), installed from the Shopify App Store.
- **WordPress / WooCommerce** — a free plugin called **Scayla Connect**, installed from the wordpress.org plugin directory (or by uploading the zip), which connects the site to the service. The connection is described in full in section 3.5.

The service runs on these domains: scayla.co.il (marketing site), app.scayla.co.il (the Shopify-embedded app) and wp-api.scayla.co.il (the service interface for WordPress sites).

Data controller and service operator:
- Legal entity: Lior Zabari Ltd.
- Company number: 516967395 (Israel)
- Operator website: mrmake.co.il
- Contact for privacy matters: lior+scayla@mrmake.co.il

## 2. Our privacy principles
- We collect only the data necessary to provide and operate the service (data minimisation).
- We use data solely for the purposes described in this policy, and solely to deliver the service for **your store**.
- Scayla contains no advertising. We do not sell your data and we do not share it with third parties for commercial purposes.
- We do not use your data, including data received from Google, to train general-purpose AI models.
- Control stays with you: you can disconnect any source at any time, remove the Shopify app, or disconnect a WordPress site from the site itself (deleting the service user or deactivating the plugin immediately revokes the service's access).

## 3. What data we collect
### 3.1 Store owner details
- **On Shopify**: the email address and store details (name, domain) received from Shopify at install time.
- **On WordPress / WooCommerce**: the email address and site address you provide when signing up.
- On both platforms: the brand contact details you fill in during onboarding.

### 3.2 Store data on Shopify (through the Shopify scopes you approved: `write_content`, `write_products`, `write_files`, `write_online_store_navigation`)
- Products, collections, blog articles, images and alt text, and URL redirects. These are used to analyse SEO/GEO status and to generate, and with your explicit approval apply, improvements to **your store**. Every change is reversible.

### 3.3 Google data you connect (read-only scopes, via separate OAuth per source)
- **Google Search Console** (`webmasters.readonly`): search queries, clicks, impressions and positions for your site.
- **Google Analytics 4** (`analytics.readonly`): traffic and conversion data for your GA4 property.
- **Google Business Profile** (`business.manage`, when enabled): locations, ratings and reviews for your business.

### 3.4 OAuth tokens
- Google refresh/access tokens are stored separately per store and are used only to read the sources above on your behalf. We request read-only scopes wherever the feature allows.

### 3.5 Site data on WordPress / WooCommerce (through the Scayla Connect plugin)

The following is a complete and accurate list of what leaves your site for Scayla, and when. It corresponds one-to-one with the plugin's public documentation in the wordpress.org directory.

**a. At pairing.** You start this from Scayla; it arrives at your site as an authenticated request. The response sends:
- the site address and its REST API address
- WordPress and WooCommerce version numbers
- the permalink structure
- which SEO plugin was detected (Yoast SEO / Rank Math / none)
- the login name of the dedicated service user just created
- **once only, in that one response**: the API token the site mints for Scayla. The site itself stores only a SHA-256 hash of it, never the token.

**b. While the service operates** (each time Scayla's servers call the site with the paired token): the content being worked on. That is: titles and descriptions of products, posts, pages and categories; SEO titles and meta descriptions; image alt text; FAQ questions and answers; and redirect paths.

**c. When Scayla checks the connection** (an authenticated health call): plugin version, WordPress and WooCommerce versions, the detected SEO plugin, permalink structure, site URL and home URL, locale, time zone, and the first 8 characters of the stored token hash as a connection fingerprint. The token itself is never returned.

**What never leaves your site:**
No visitor data, no IP addresses, no analytics data, no tracking beacons, no order or customer data, and no user accounts or email addresses belonging to your site's users. No data is sent to any host other than Scayla.

**One more fact we want to state plainly:**
> The plugin makes no outbound requests at all. It contains no HTTP client. All traffic is inbound: Scayla's servers call the site's REST API and authenticate with the paired token, and data leaves the site only inside the response to one of those authenticated requests. The plugin never contacts Scayla, on any schedule or any event, including on deactivation.

**Scope of access.** The service operates through a dedicated user with a narrow, fixed capability list. It cannot install plugins, manage users, change site settings, or log in to the site at all.

We do not collect device location data, and we do not access the camera, microphone or contacts.

## 4. Why we use the data
1. Providing the service: measuring visibility in Google and in AI engines, keyword research, generating content and metadata suggestions, and (only with your approval, per action) applying improvements to the store.
2. Weekly share-of-voice measurement against competitors.
3. Necessary operational communication (for example service updates and replies to enquiries).
4. Maintaining service integrity, preventing abuse, and complying with legal requirements.

## 5. Use of Google API data — Limited Use
Scayla's use and transfer of information received from Google APIs adheres to the [Google API Services User Data Policy](https://developers.google.com/terms/api-services-user-data-policy), including the **Limited Use** requirements. Specifically: Google user data is used only to provide or improve user-facing features visible in the Scayla interface; is not transferred to others except as needed to provide or improve those features, to comply with law, or as part of a merger; is not used for advertising and is not sold; and humans do not read the data, except with your consent for support, for security purposes, or as required by law.

## 6. AI content generation
To generate SEO/GEO content and suggestions, relevant store content (for example product titles and descriptions, and topics) is sent to Google Vertex AI (Gemini) for processing and output **for your store only**. This data is not used to train our models or Google's. For **measurement only** of public ChatGPT answers, we run queries against OpenAI; we do not send your store's private data for that purpose.

## 7. Third-party services (our data processors)
We use infrastructure providers acting as data processors, governed by data processing agreements (DPAs):
- **Shopify** — for Shopify stores only: the platform the app runs inside, and the origin of store data. WordPress sites do not pass through Shopify at any stage.
- **Google Cloud** — Vertex AI/Gemini (generation), Cloud Run hosting and database (region me-west1, Tel Aviv), and calls to Google APIs.
- **OpenAI** — for measuring ChatGPT answers only (not for content generation, and no private store data is sent).
- **Cloudflare** — network/edge infrastructure.
- **Payment processor** — for customers outside Shopify, an external payment provider acting as Merchant of Record issues the invoice and collects payment. We do not store your payment instrument details.

## 8. Where data is stored
Data is stored and processed in Google Cloud (production database) in region me-west1 (Tel Aviv), and on Google's global infrastructure for API calls.

## 9. Transfers outside Israel
Infrastructure providers may store and process data on servers outside Israel, including in the United States. Transfers rely on the exceptions in the Israeli Privacy Protection Regulations (Transfer of Data to Databases Abroad), 2001: (1) your informed consent, given when you accept this policy at install time; and (2) the receiving provider's written contractual undertaking (in the DPA) to protect the data at a level consistent with Israeli law principles.

## 10. Data security
We apply reasonable and accepted measures appropriate to the nature and scope of the data, and no lower than the intermediate security level: tokens are stored separately per store and used only for the reads you approved; reliance on Google's secured cloud infrastructure with per-store permissions; authentication through OAuth. On the WordPress side, the site stores only a SHA-256 hash of the service token, never the token itself. No system is completely immune. In the event of a serious security incident we will act according to law, including the Privacy Protection Regulations (Data Security), 2017, and will notify the authority and data subjects as required.

## 11. Data Protection Officer
We have assessed the scope of our activity and the nature of the data. As of this date we do not consider that a statutory obligation to appoint a DPO applies; should such an obligation arise we will appoint one and update this policy.

## 12. Retention
- **Store data, Google data and tokens**: retained while Scayla is connected and needed to provide the service.
- **On Shopify · following app removal, Shopify's mandatory webhooks (`shop/redact`, `customers/redact`), or a deletion request**: all related records (including Google tokens and generated content) are deleted (cascade), within a reasonable time and in any event no later than 30 days.
- **On WordPress / WooCommerce · how to disconnect and delete**: disconnection is immediate and is done from the site side, without depending on us: deleting the service user or deactivating the plugin revokes the token, and from that moment Scayla's servers cannot access the site. To delete data held by us, send a request to lior+scayla@mrmake.co.il; deletion will be completed within a reasonable time and in any event no later than 30 days. The same window applies to subscription cancellation.
- **Operational and technical logs**: up to 12 months, unless required otherwise to investigate an incident or by law.
- **Data required to be retained by law**: for the applicable statutory period, then deleted or anonymised.

## 13. Your rights
Under applicable law you have rights of access, correction, deletion and withdrawal of consent regarding your data. Some actions can be performed directly in the service (disconnecting a source, removing the app, disconnecting a WordPress site). For consolidated access or full deletion, contact us at lior+scayla@mrmake.co.il. We will respond within a reasonable time, and in any event no later than 30 days, unless a reasoned extension is required. If you believe your rights have been infringed, you may file a complaint with the Israeli Privacy Protection Authority at the Ministry of Justice.

## 14. Cookies
The Shopify app runs inside Shopify Admin and uses strictly necessary technical cookies only (session state and preferences). Scayla contains no advertising cookies. The WordPress plugin sets no cookies at all and loads no script or stylesheet on your site. On the marketing site (scayla.co.il) only, aggregate measurement tools may be used, and only after obtaining your consent (which you may refuse).

## 15. Accessibility
We work to make the service accessible in accordance with law. The full accessibility statement is available at scayla.co.il/accessibility. Enquiries: lior+scayla@mrmake.co.il.

## 16. Changes and contact
We may update this policy; a material change concerning collection, use or transfer of data will be brought to your attention, and where necessary we will ask for renewed consent. Governing law is the law of the State of Israel, and jurisdiction lies with the competent courts in Israel.

- Service operator / data controller: Lior Zabari Ltd., company number 516967395 (mrmake.co.il)
- Privacy and accessibility contact: Lior Zabari · lior+scayla@mrmake.co.il
