FROM node:22-slim
WORKDIR /app
COPY package.json ./
RUN npm install --omit=dev --no-audit --no-fund
COPY machine.mjs server.mjs ./
ENV NODE_ENV=production
CMD ["node", "server.mjs"]
