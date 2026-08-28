# syntax=docker/dockerfile:1

# ---- build ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# `next build` imports every route (including API routes) to collect page
# data, and some modules read env vars at *module load time*, not just at
# call time — so the build needs placeholder values present even though
# they're never used for a real connection here. Real values are injected
# at container runtime via docker-compose's env_file. (Same pattern used
# for the ADMINIS deploy on this same VPS.)
ENV NEXT_PUBLIC_SUPABASE_URL=https://placeholder.supabase.co \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=placeholder \
    SUPABASE_SERVICE_ROLE_KEY=placeholder \
    ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 \
    META_APP_SECRET=placeholder \
    NEXT_PUBLIC_SITE_URL=https://placeholder.example.com \
    NEXT_PUBLIC_APP_LOCALE=es

COPY package.json package-lock.json ./
RUN npm ci

COPY . .
RUN npm run build

# ---- runtime ----
FROM node:20-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production

COPY --from=builder /app/public ./public
COPY --from=builder /app/.next ./.next
COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/next.config.ts ./next.config.ts
COPY --from=builder /app/messages ./messages

EXPOSE 3000
CMD ["npm", "run", "start"]
