import * as Sentry from "@sentry/nextjs";

import { scrubSentryEvent, type SentryEventLike } from "@/lib/observability/scrub";

/**
 * Sentry — runtime Edge (middleware). Gated por `SENTRY_DSN`. `beforeSend` pasa por
 * el scrubber (RUN/correo/token SENCE/secretos nunca salen). Sin logs.
 */
const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENCE_ENV ?? "production",
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event as unknown as SentryEventLike) as unknown as typeof event,
  });
}
