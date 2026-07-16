import "server-only";

import Redis from "ioredis";

/**
 * Cliente Redis LAZY para la app web (rate-limiting, task 3.6). Distinto del
 * worker: aquí solo se usa para contadores de ventana. Sin `REDIS_URL` devuelve
 * null → el rate-limit hace fail-open (no bloquea el flujo de aprendizaje).
 */
let cached: Redis | null | undefined;

export function getRedis(): Redis | null {
  if (cached !== undefined) return cached;
  const url = process.env.REDIS_URL;
  if (!url) {
    cached = null;
    return null;
  }
  try {
    cached = new Redis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    // Un error de conexión no debe tumbar el proceso: se loguea y el limiter
    // hará fail-open en la siguiente operación.
    cached.on("error", () => undefined);
  } catch {
    cached = null;
  }
  return cached;
}
