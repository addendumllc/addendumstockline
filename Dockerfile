# Addendum-Stockline: one small Node server. Data lives in /data (mount a persistent disk there).
FROM node:22-slim
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --omit=dev
COPY . .
ENV NODE_ENV=production BIND_HOST=0.0.0.0 PORT=3000 STOCKLINE_DATA_DIR=/data TRUST_PROXY=1
EXPOSE 3000
CMD ["node", "server/index.js"]
