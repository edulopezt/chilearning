# syntax=docker/dockerfile:1
# Build standalone de Next.js para deploy en Coolify (plan §7).
# Multi-stage: deps -> build -> runner mínimo (output: "standalone").
# La app worker (task 2.6) se construye con `--target worker` (en Coolify:
# dockerfile_target_build=worker): imagen propia, mínima y SIN build de Next.
# El target por defecto (último stage) sigue siendo `runner` (la app web).

FROM node:24-alpine AS base
RUN corepack disable && npm i -g pnpm@11.13.0

# ---------- deps ----------
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------- build (app Next) ----------
FROM base AS build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
# Next inlina las NEXT_PUBLIC_* en el bundle del navegador EN EL BUILD, así que
# deben estar presentes al compilar. La URL y la anon key son públicas por
# diseño (la anon key va en el navegador); Coolify las pasa como build args.
ARG NEXT_PUBLIC_SUPABASE_URL
ARG NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_PUBLIC_SUPABASE_URL=$NEXT_PUBLIC_SUPABASE_URL
ENV NEXT_PUBLIC_SUPABASE_ANON_KEY=$NEXT_PUBLIC_SUPABASE_ANON_KEY
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm build

# ---------- worker-build (bundle esbuild, sin Next) ----------
FROM base AS worker-build
WORKDIR /app
COPY --from=deps /app/node_modules ./node_modules
COPY . .
RUN pnpm build:worker

# ---------- worker (proceso de jobs, task 2.6) ----------
# No es el stage final a propósito: el build por defecto produce `runner`.
FROM node:24-alpine AS worker
WORKDIR /app
ENV NODE_ENV=production
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 worker
COPY --from=worker-build --chown=worker:nodejs /app/dist/worker ./dist/worker
USER worker
CMD ["node", "dist/worker/index.js"]

# ---------- runner (app web) ----------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
# Healthcheck (task 3.7): golpea /api/health (público). Coolify/Docker reinician
# el contenedor si la app deja de responder.
HEALTHCHECK --interval=30s --timeout=3s --start-period=25s --retries=3 \
  CMD wget -qO- http://127.0.0.1:3000/api/health >/dev/null 2>&1 || exit 1
CMD ["node", "server.js"]
