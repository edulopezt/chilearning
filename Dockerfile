# syntax=docker/dockerfile:1
# Build standalone de Next.js para deploy en Coolify (plan §7).
# Multi-stage: deps -> build -> runner mínimo (output: "standalone").

FROM node:24-alpine AS base
RUN corepack disable && npm i -g pnpm@11.13.0

# ---------- deps ----------
FROM base AS deps
WORKDIR /app
COPY package.json pnpm-lock.yaml pnpm-workspace.yaml ./
RUN pnpm install --frozen-lockfile

# ---------- build ----------
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
# Bundle del worker de jobs (task 2.6): mismo repo, proceso aparte. En Coolify
# la app worker usa esta misma imagen con start command `node dist/worker/index.js`.
RUN pnpm build:worker

# ---------- runner ----------
FROM node:24-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
RUN addgroup --system --gid 1001 nodejs \
  && adduser --system --uid 1001 nextjs
COPY --from=build /app/public ./public
COPY --from=build --chown=nextjs:nodejs /app/.next/standalone ./
COPY --from=build --chown=nextjs:nodejs /app/.next/static ./.next/static
COPY --from=build --chown=nextjs:nodejs /app/dist/worker ./dist/worker
USER nextjs
EXPOSE 3000
ENV PORT=3000 HOSTNAME=0.0.0.0
CMD ["node", "server.js"]
