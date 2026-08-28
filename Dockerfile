# syntax=docker/dockerfile:1

# ---- build ----
FROM node:20-bookworm-slim AS builder
WORKDIR /app

# `next build` imports every route (including API routes) to collect page
# data, and some modules read env vars at *module load time*, not just at
# call time — so the build needs values present even though server-only
# secrets are never used for a real connection at build time (those are
# injected fresh at container runtime via docker-compose's env_file).
#
# NEXT_PUBLIC_* is different: Next.js inlines those values into the
# client-side JS bundle AT BUILD TIME — there is no "runtime" for them.
# Shipping a placeholder here would ship a browser bundle that tries to
# reach a fake Supabase URL. So the *_PUBLIC_* ones must be real values,
# passed in as build args from docker-compose (which reads them from the
# same .env file already sitting next to it).
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ARG NEXT_PUBLIC_SITE_URL
ARG NEXT_PUBLIC_APP_LOCALE=es

ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL \
    NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY \
    NEXT_PUBLIC_SITE_URL=$NEXT_PUBLIC_SITE_URL \
    NEXT_PUBLIC_APP_LOCALE=$NEXT_PUBLIC_APP_LOCALE \
    SUPABASE_SERVICE_ROLE_KEY=placeholder \
    ENCRYPTION_KEY=0000000000000000000000000000000000000000000000000000000000000000 \
    META_APP_SECRET=placeholder

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
