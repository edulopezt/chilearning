import * as Sentry from "@sentry/nextjs";

/**
 * Hook de instrumentación de Next (task 3.7). Carga la config de Sentry del runtime
 * correspondiente. Todo gated por DSN dentro de cada config → no-op sin cuenta.
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    await import("./sentry.server.config");
  }
  if (process.env.NEXT_RUNTIME === "edge") {
    await import("./sentry.edge.config");
  }
}

// Captura los errores de request del servidor (App Router). Requiere @sentry/nextjs >= 8.28.
export const onRequestError = Sentry.captureRequestError;
