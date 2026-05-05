FROM node:20-bookworm-slim

WORKDIR /app

# better-sqlite3 needs build tools the first time prebuilt isn't available
RUN apt-get update \
    && apt-get install -y --no-install-recommends python3 build-essential ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY package*.json ./
RUN npm ci --omit=dev

COPY . .

# Capacitor / Android folders aren't needed at runtime
RUN rm -rf android ios

ENV NODE_ENV=production
ENV PORT=10000
EXPOSE 10000

CMD ["node", "server.js"]
