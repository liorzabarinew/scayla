# מכונת התוכן היומית · Cloud Run Job (מחליף את GitHub Actions daily-content).
# הדימוי גנרי · הריפו נמשך טרי בזמן ריצה (entrypoint), אז שינוי תוכן לא מצריך
# בנייה מחדש של הדימוי.
FROM node:22-slim

# git = clone/commit/push · wrangler = deploy · ca-certificates = HTTPS/git
RUN apt-get update \
  && apt-get install -y --no-install-recommends git ca-certificates \
  && rm -rf /var/lib/apt/lists/*
RUN npm install -g wrangler@4

WORKDIR /app
COPY entrypoint.sh /app/entrypoint.sh
RUN chmod +x /app/entrypoint.sh

ENTRYPOINT ["/app/entrypoint.sh"]
