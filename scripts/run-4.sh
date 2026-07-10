#!/usr/bin/env bash
# מריץ מאמר אחד לכל אחד מ-4 האשכולות, ברצף. כל RESULT נכתב ללוג.
cd "$(dirname "$0")/.."
export GOOGLE_SA="$(cat .secrets/sa.json)"
export GCP_PROJECT=scayla-prod
export GCP_REGION=us-central1
LOG=scripts/run-4.log
: > "$LOG"
for C in geo-ai seo-shopify ecommerce guides; do
  echo "════════ $C ════════" | tee -a "$LOG"
  node scripts/machine-vertex.mjs "$C" --publish 2>&1 | tee -a "$LOG"
  echo "" | tee -a "$LOG"
done
echo "ALL DONE" | tee -a "$LOG"
