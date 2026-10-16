# Frontend image for the self-hosted VUB deployment (see deploy/README.md).
# Stage 1 builds the SPA; stage 2 serves it with Caddy, which also routes
# /api/* to FastAPI and the Supabase paths to Kong.
#
# VITE_* values are baked in at build time, so pass them as build args:
#   docker build -t battery-lci-web \
#     --build-arg VITE_SUPABASE_URL=https://battery-lci.vub.be \
#     --build-arg VITE_SUPABASE_ANON_KEY=<ANON_KEY> \
#     --build-arg VITE_RAILWAY_FASTAPI_URL=https://battery-lci.vub.be \
#     ./web

FROM node:20-alpine AS build

WORKDIR /app

# Install dependencies first (better layer caching)
COPY package.json package-lock.json ./
RUN npm ci

COPY . .

ARG VITE_SUPABASE_URL
ARG VITE_SUPABASE_ANON_KEY
ARG VITE_RAILWAY_FASTAPI_URL
RUN test -n "$VITE_SUPABASE_URL" && test -n "$VITE_SUPABASE_ANON_KEY" && test -n "$VITE_RAILWAY_FASTAPI_URL" \
    || (echo "Missing VITE_* build args" >&2 && exit 1)
RUN npm run build

FROM caddy:2.8.4-alpine

COPY Caddyfile /etc/caddy/Caddyfile
COPY --from=build /app/dist /srv

EXPOSE 80
