FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
# כל ה-.mjs · רשימה מפורשת שכחה את articles.mjs והקונטיינר קרס בהפעלה
COPY *.mjs ./
ENV NODE_ENV=production
CMD ["node", "server.mjs"]
