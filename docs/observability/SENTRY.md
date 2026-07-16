# Sentry — errores (task 3.7, Plan §10)

Rastreo de errores de la app + worker con **release tracking**. Estado: el
**scrubber de PII/secretos** (`src/lib/observability/scrub.ts`) está **listo y
testeado** (la red de seguridad de que el token SENCE, RUN, correo y secretos
NUNCA salen a Sentry — RNF-10). El **SDK `@sentry/nextjs` queda PARQUEADO**: sin
DSN no aporta valor y `withSentryConfig` toca el pipeline de build (riesgo para un
despliegue no supervisado). Se activa cuando Edu cree el proyecto Sentry.

## Activación (handoff a Edu)
1. Crear proyecto Next.js en sentry.io (free tier). Copiar el **DSN** a
   `SENTRY_DSN` y el auth token a `SENTRY_AUTH_TOKEN` (solo CI, sourcemaps).
2. `pnpm add @sentry/nextjs` y correr `npx @sentry/wizard@latest -i nextjs`
   (crea `sentry.{server,edge,client}.config.ts` + `instrumentation.ts` +
   envuelve `next.config.ts` con `withSentryConfig`).
3. **OBLIGATORIO**: en cada `Sentry.init({...})`, pasar
   `beforeSend: (event) => scrubSentryEvent(event as SentryEventLike)` (server,
   edge, client) y en el worker (`src/worker/index.ts`) el mismo `beforeSend`.
   Sin el scrubber NO se activa (regla dura SENCE: el token jamás sale del proceso).
   **ADEMÁS OBLIGATORIO** en el server/worker: `includeLocalVariables: false`. El
   token del OTEC **descifrado** vive en una variable de stack (`token`) con forma
   de UUID → ningún regex de valor puede reconocerlo; la única garantía robusta es
   NO enviar las variables de frame (4-ojos F1). El scrubber redacta además por
   nombre de clave (`token`/`key`/`secret`/…) como segunda capa.
4. `SENTRY_RELEASE = git SHA` como build arg (Coolify) + CI para correlacionar.

## Verificación
- Con DSN vacío el SDK es no-op (cero llamadas de red).
- Con un DSN de prueba: disparar un error que contenga un RUN/token/correo y
  confirmar en Sentry que llegan **redactados** (`[REDACTED_*]`). El test
  `observability.test.ts` ya prueba el scrubber unitariamente.
