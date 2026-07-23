# מכונת התוכן היומית · Cloud Run Job (GCP) — הפרקטיקה

מסמך זה מתעד את **הדפוס** (pattern) של העברת מכונת תוכן יומית מ-GitHub Actions
ל-GCP (Cloud Run Job + Cloud Scheduler). נכתב כדי שנוכל לחזור עליו 1:1 עבור
בנק-קט ופרויקטים אחרים. הסיבה: לממש קרדיטים של GCP (בתוקף עד 2027) במקום לשלם
דקות GitHub Actions.

## למה Cloud Run Job (ולא Cloud Function / VM / Actions)

| דרישה | Cloud Run Job | למה |
|---|---|---|
| ריצה ארוכה (~30–60 ד׳, 4 אשכולות Gemini) | ✅ task-timeout עד 24h | Cloud Functions gen2 מוגבל ל-60 ד׳; Job נוח יותר |
| cron יומי | ✅ Cloud Scheduler → `jobs:run` | טריגר native, אין דקות בתשלום |
| git clone/commit/push + build + wrangler deploy | ✅ קונטיינר עם git+node+wrangler | סביבה מלאה, לא sandbox |
| סודות | ✅ Secret Manager → env | אותם סודות, לא GitHub Secrets |

## הארכיטקטורה

```
Cloud Scheduler (0 5 * * * UTC)
   └─POST oauth─▶ run.googleapis.com/.../jobs/scayla-content:run
                    └─▶ Cloud Run Job "scayla-content" (me-west1)
                          image: .../scayla-content:latest  (generic; entrypoint.sh)
                          SA: scayla-machine@scayla-prod
                          secrets→env: GOOGLE_SA, CLOUDFLARE_API_TOKEN, GITHUB_TOKEN
                          env: GCP_PROJECT, GCP_REGION=us-central1, CLUSTER_TIMEOUT_MIN, CLOUDFLARE_ACCOUNT_ID
                          entrypoint: clone→npm ci→npm test→daily.mjs→rebase→build→commit→push→wrangler deploy→notify
```

**עיקרון מפתח — הדימוי גנרי, הריפו נמשך טרי בזמן ריצה.** `entrypoint.sh` עושה
`git clone` של הריפו בכל ריצה. לכן שינוי קוד/תוכן **לא** מצריך build מחדש של
הדימוי. build מחדש נדרש רק אם משנים את `entrypoint.sh` עצמו או את ה-Dockerfile.

**source-of-truth נשאר git.** הריצה מקמיטה ודוחפת `content: daily run` ל-origin/main
בדיוק כמו ב-Actions, אז [[scayla-website]] deploy-guard וכלל "הריפו = הפרודקשן"
נשארים בתוקף. אין שינוי סמנטי — רק הקומפיוט עבר מ-GitHub ל-GCP.

## פקודות ההקמה (הרצנו אותן; לשחזור/בנק-קט)

```bash
PROJECT=scayla-prod; REGION=me-west1
IMG=$REGION-docker.pkg.dev/$PROJECT/cloud-run-source-deploy/scayla-content:latest

# 1. APIs
gcloud services enable run.googleapis.com cloudscheduler.googleapis.com \
  cloudbuild.googleapis.com artifactregistry.googleapis.com --project=$PROJECT

# 2. סודות (פעם אחת) — כל אחד: create + add-iam-policy-binding secretAccessor ל-SA
#    scayla-google-sa (מפתח SA JSON) · scayla-cf-token (CF token, Pages·Edit) · scayla-github-token (fine-grained PAT, Contents:RW, no-expiry)

# 3. build הדימוי
gcloud builds submit --project=$PROJECT --region=$REGION --tag $IMG ops/content-job/

# 4. Job
gcloud run jobs create scayla-content --project=$PROJECT --region=$REGION \
  --image=$IMG --service-account=scayla-machine@$PROJECT.iam.gserviceaccount.com \
  --task-timeout=4500 --max-retries=0 --cpu=2 --memory=4Gi \
  --set-env-vars="GCP_PROJECT=$PROJECT,GCP_REGION=us-central1,CLUSTER_TIMEOUT_MIN=12,CLOUDFLARE_ACCOUNT_ID=<acct>" \
  --set-secrets="GOOGLE_SA=scayla-google-sa:latest,CLOUDFLARE_API_TOKEN=scayla-cf-token:latest,GITHUB_TOKEN=scayla-github-token:latest"

# 5. הרשאת invoke ל-SA + Scheduler
gcloud run jobs add-iam-policy-binding scayla-content --project=$PROJECT --region=$REGION \
  --member="serviceAccount:scayla-machine@$PROJECT.iam.gserviceaccount.com" --role="roles/run.invoker"

gcloud scheduler jobs create http scayla-content-daily --project=$PROJECT --location=$REGION \
  --schedule="0 5 * * *" --time-zone="Etc/UTC" \
  --uri="https://$REGION-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/$PROJECT/jobs/scayla-content:run" \
  --http-method=POST \
  --oauth-service-account-email=scayla-machine@$PROJECT.iam.gserviceaccount.com \
  --oauth-token-scope=https://www.googleapis.com/auth/cloud-platform
```

## תפעול

```bash
# ריצה ידנית (בדיוק כמו workflow_dispatch)
gcloud run jobs execute scayla-content --project=scayla-prod --region=me-west1

# עדכון הדימוי אחרי שינוי entrypoint.sh / Dockerfile
gcloud builds submit --project=scayla-prod --region=me-west1 --tag $IMG ops/content-job/
# (הריצה הבאה מרימה :latest אוטומטית; אין צורך לעדכן את ה-Job)

# לוגים
gcloud logging read 'resource.type="cloud_run_job" resource.labels.job_name="scayla-content"' \
  --project=scayla-prod --limit=100 --freshness=1d
```

## מה השתנה מול Actions (בכוונה)

- `secrets.X` → Secret Manager (`--set-secrets`).
- `secrets.GOOGLE_SA` הוזרק כ-env (הסקריפטים דורשים את מפתח ה-SA כ-env, לא ADC).
- `cloudflare/wrangler-action` → `wrangler` מותקן גלובלית בדימוי + `pages deploy`.
- `.github/workflows/daily-content.yml` — ה-`schedule` בוטל (הושאר `workflow_dispatch`
  כגיבוי-חירום ידני). כל השאר זהה 1:1.

## החלה על בנק-קט (הצעד הבא)

אותו דפוס בדיוק. הבדלים צפויים: פרויקט GCP אחר, ריפו אחר, יעד deploy אחר
(בנק-קט = Firebase/Astro), וייתכן secrets נוספים. לשכפל את `ops/content-job/`
עם entrypoint מותאם לצינור של בנק-קט.
