#!/usr/bin/env bash
# ─────────────────────────────────────────────────────────────────────────────
# מכונת התוכן היומית · רצה כ-Cloud Run Job על GCP (במקום GitHub Actions).
# מדויק 1:1 מול .github/workflows/daily-content.yml · אותם שלבים, אותה fail-closed
# לוגיקה, אותו source-of-truth (git). ההבדל היחיד: הקומפיוט על GCP (קרדיטים),
# לא על דקות GitHub בתשלום.
#
# סודות (מוזרקים כ-env מ-Secret Manager ע"י ה-Job): GITHUB_TOKEN,
# CLOUDFLARE_API_TOKEN, CLOUDFLARE_ACCOUNT_ID, GOOGLE_SA. אופציונלי:
# TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID. env רגיל: GCP_PROJECT, GCP_REGION,
# CLUSTER_TIMEOUT_MIN.
# ─────────────────────────────────────────────────────────────────────────────
set -euo pipefail

: "${GITHUB_TOKEN:?GITHUB_TOKEN required}"
: "${CLOUDFLARE_API_TOKEN:?CLOUDFLARE_API_TOKEN required}"
: "${CLOUDFLARE_ACCOUNT_ID:?CLOUDFLARE_ACCOUNT_ID required}"
: "${GOOGLE_SA:?GOOGLE_SA required}"

REPO="https://x-access-token:${GITHUB_TOKEN}@github.com/liorzabarinew/scayla.git"
WORK=/tmp/scayla

# ── clone טרי (היסטוריה מלאה · ה-rebase למטה משחזר pushes מקבילים) ──
rm -rf "$WORK"
git clone "$REPO" "$WORK"
cd "$WORK"
git config user.name  "scayla-machine"
git config user.email "machine@scayla.co.il"

npm ci

# ── fail-CLOSED שער 1: בדיקות ה-guards · guard שבור מבטל לפני שריפת Gemini ──
npm test

# ── מוח התוכן · 4 אשכולות → רעיונות/כתיבה/QA/קאבר/רענון/שלמות ──
node scripts/daily.mjs

# ── SYNC ל-main האחרון לפני build+deploy · push מקביל לא ייתם את המאמרים ──
git pull --rebase --autostash origin main

# ── fail-CLOSED: build · תוכן שבור לא נוחת ──
npm run build

# ── commit + push · ה-push חייב להצליח (בלי '|| echo'): כישלון מפיל את הריצה
#    ומדלג על ה-deploy, אז לעולם לא פורסים תוכן שלא ב-git ──
git add src/content/magazine public/covers public/llms.txt public/llms-full.txt scripts/topics.json scripts/topics-done.json
if git commit -m "content: daily run $(date -u +%F)"; then
  git push origin HEAD:main
else
  echo "nothing to commit"
fi

# ── deploy ל-Cloudflare Pages ──
wrangler pages deploy dist --project-name scayla --branch main

# ── דיווח (no-op בלי טוקן טלגרם) ──
node scripts/notify.mjs "🚀 פריסת scayla.co.il הושלמה · Cloud Run Job (GCP)" || true

echo "✓ daily content run complete"
