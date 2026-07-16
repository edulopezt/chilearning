import * as Sentry from "@sentry/nextjs";

import { scrubSentryEvent, type SentryEventLike } from "@/lib/observability/scrub";

/**
 * Sentry — runtime Node (task 3.7). Gated por `SENTRY_DSN`: sin DSN no inicializa
 * (no-op en dev/CI/staging hasta que Edu ponga la cuenta). `beforeSend` pasa por
 * el scrubber que borra RUN/correo/token SENCE/secretos (RED DE SEGURIDAD, D-034).
 * `includeLocalVariables:false` es OBLIGATORIO: el token del OTEC descifrado vive
 * en una variable local y sin esto Sentry lo capturaría (4-ojos F1 de 3.7).
 */
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENCE_ENV ?? "production",
    release: process.env.GIT_SHA,
    tracesSampleRate: 0.1,
    includeLocalVariables: false,
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event as unknown as SentryEventLike) as unknown as typeof event,
  });
}
