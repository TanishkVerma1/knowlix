# Knowlix production image (Next.js standalone server).
#   docker compose up --build          → app + Postgres on http://localhost:3000
FROM node:24-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN npm ci --no-audit --no-fund

FROM node:24-alpine AS build
WORKDIR /app
ENV NEXT_TELEMETRY_DISABLED=1 BUILD_STANDALONE=1
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN npm run build

FROM node:24-alpine AS run
WORKDIR /app
ENV NODE_ENV=production NEXT_TELEMETRY_DISABLED=1 PORT=3000 HOSTNAME=0.0.0.0
RUN addgroup -S knowlix && adduser -S knowlix -G knowlix && mkdir -p /app/.data && chown knowlix:knowlix /app/.data
COPY --from=build --chown=knowlix:knowlix /app/.next/standalone ./
COPY --from=build --chown=knowlix:knowlix /app/.next/static ./.next/static
COPY --from=build --chown=knowlix:knowlix /app/public ./public
USER knowlix
EXPOSE 3000
HEALTHCHECK --interval=30s --timeout=10s --start-period=20s CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null || exit 1
CMD ["node", "server.js"]
