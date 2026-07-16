import * as Sentry from "@sentry/nextjs";

import { scrubSentryEvent, type SentryEventLike } from "@/lib/observability/scrub";

/**
 * Sentry — runtime navegador (task 3.7). Gated por `NEXT_PUBLIC_SENTRY_DSN`.
 * SIN Session Replay ni Logs a propósito: grabarían PII en pantalla (RUN, nombres)
 * o en logs — incompatible con Ley 21.719 / RNF-10. `beforeSend` pasa por el
 * scrubber. Se puede añadir Replay más adelante con `maskAllText`/`blockAllMedia`.
 */
const dsn = process.env.NEXT_PUBLIC_SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.NEXT_PUBLIC_SENCE_ENV ?? "production",
    tracesSampleRate: 0.1,
    sendDefaultPii: false,
    beforeSend: (event) => scrubSentryEvent(event as unknown as SentryEventLike) as unknown as typeof event,
  });
}

export const onRouterTransitionStart = Sentry.captureRouterTransitionStart;
