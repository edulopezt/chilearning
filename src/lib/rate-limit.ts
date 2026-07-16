/**
 * Rate-limiting de ventana fija (task 3.6, Plan §9). Núcleo PURO + `enforce()`
 * que devuelve un 429 o null. FAIL-OPEN: sin Redis o ante error de backend, no
 * bloquea (la disponibilidad del flujo de aprendizaje > un límite estricto).
 * Va en los route handlers Node (los endpoints propios que tocamos, p.ej. SENCE);
 * el login es client-side directo a Supabase y se limita con sus knobs nativos.
 * El backend Redis se importa DINÁMICO (server-only) para poder testear el
 * núcleo con un backend inyectado sin cargar ioredis.
 */

export function rateLimitKey(surface: string, dim: string, id: string, windowStartSec: number): string {
  return `rl:${surface}:${dim}:${id}:${windowStartSec}`;
}

export function decideFromCount(count: number, limit: number): { allowed: boolean; remaining: number } {
  return { allowed: count <= limit, remaining: Math.max(0, limit - count) };
}

export interface LimitRule {
  readonly surface: string;
  readonly dim: string;
  readonly id: string;
  readonly limit: number;
  readonly windowSec: number;
}

export interface RlBackend {
  /** Incrementa el contador de `key` y fija su TTL en el primer hit. */
  incr(key: string, ttlSec: number): Promise<number>;
}

async function defaultBackend(): Promise<RlBackend | null> {
  const { getRedis } = await import("@/lib/redis");
  const r = getRedis();
  if (!r) return null;
  return {
    async incr(key, ttlSec) {
      const n = await r.incr(key);
      if (n === 1) await r.expire(key, ttlSec);
      return n;
    },
  };
}

/**
 * Aplica las reglas. Devuelve un 429 (con Retry-After) si alguna se excede, o
 * null para continuar. `backend` inyectable (tests); undefined = Redis por
 * defecto (dinámico). `nowMs` inyectable para tests deterministas.
 */
export async function enforce(
  rules: readonly LimitRule[],
  backend?: RlBackend | null,
  nowMs: number = Date.now(),
): Promise<Response | null> {
  try {
    // Resolver el backend DENTRO del try: si el import dinámico o getRedis()
    // llegaran a lanzar, se hace fail-open en vez de 500 (4-ojos M2).
    const b = backend === undefined ? await defaultBackend() : backend;
    if (!b) return null; // fail-open: sin Redis no se limita.
    const now = Math.floor(nowMs / 1000);
    for (const rule of rules) {
      const windowStart = Math.floor(now / rule.windowSec) * rule.windowSec;
      const key = rateLimitKey(rule.surface, rule.dim, rule.id, windowStart);
      const count = await b.incr(key, rule.windowSec);
      if (!decideFromCount(count, rule.limit).allowed) {
        const retryAfter = windowStart + rule.windowSec - now;
        return new Response(JSON.stringify({ error: "rate_limited" }), {
          status: 429,
          headers: { "content-type": "application/json", "retry-after": String(Math.max(1, retryAfter)) },
        });
      }
    }
    return null;
  } catch {
    return null; // fail-open ante error de backend.
  }
}
