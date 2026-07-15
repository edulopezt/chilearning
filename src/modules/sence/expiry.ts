import type { SupabaseClient } from "@supabase/supabase-js";

import {
  errorRateAlertMessage,
  evaluateErrorRate,
  type ErrorRatePolicy,
} from "./domain/alerts";
import {
  expireSession,
  rowToState,
  type SessionStateColumns,
  type TransitionId,
} from "./domain/session";

/**
 * Task 2.6 — el tick del worker de expiración SENCE. Dispara las transiciones
 * "muertas" del contrato (T4/T6/T9, §3) que NO llegan por callback:
 *
 *  - T4: `iniciada_pendiente` que superó el timeout de abandono de Clave Única
 *    (SENCE no envía callback en ese caso). Además de la evidencia, T4 LIBERA
 *    el índice único parcial `sence_sessions_one_open_per_enrollment`: sin él,
 *    una sesión abandonada bloquea para siempre nuevos inicios del enrollment.
 *  - T6/T9: `iniciada`/`error(close)` que superaron `expires_at` (I-13).
 *
 * ⚠ SIN `import "server-only"`: este archivo lo ejecuta también el proceso
 * worker (fuera de React Server Components). No maneja el token ni secretos;
 * recibe el client service-role ya construido. El barrido es cross-tenant por
 * diseño (mismo precedente documentado que la correlación del callback en
 * `tenant-guard.ts`); cada UPDATE va anclado al `tenant_id` de su fila.
 *
 * Concurrencia: compare-and-set ESTRECHO — el UPDATE cambia SOLO `status` y
 * está condicionado al status leído. No se reusa `persistState` del engine a
 * propósito: aquel reescribe todas las columnas del estado leído, y entre el
 * read del worker y su write un `close_error` repetido pudo refrescar
 * `error_codes` sin cambiar el status (§6); reescribirlas pisaría los códigos
 * frescos con los rancios. `expireSession` solo cambia `status`, así que el
 * write angosto persiste exactamente el `state` del dominio (contrato de
 * `TransitionResult.state`).
 *
 * Idempotencia: una fila expirada sale del predicado de candidatas; un doble
 * tick concurrente compite por el CAS y exactamente uno audita. Un callback
 * tardío sobre una `expirada` NO la revive (I-15, dominio) y queda `late=true`.
 */

export interface ExpiryTickConfig {
  /** Reloj inyectado (epoch ms): los tests controlan el tiempo sin esperar 3 h. */
  readonly now: number;
  /** T4: `SENCE_PENDING_TIMEOUT_MINUTES` en ms. */
  readonly pendingTimeoutMs: number;
  /** Filas por batch (default 200). */
  readonly batchSize?: number;
  /** Tope de batches por categoría y tick (default 10). */
  readonly maxBatches?: number;
  /** Logger inyectable (default console). */
  readonly log?: Pick<Console, "warn" | "error">;
}

export interface ExpiryTickSummary {
  readonly scanned: number;
  readonly expired: { T4: number; T6: number; T9: number };
  /** CAS afectó 0 filas: ganó un callback concurrente. Consistente, no error. */
  readonly raced: number;
  /** Errores de IO por fila (no abortan el barrido). */
  readonly failed: number;
}

interface ExpiryCandidateRow extends SessionStateColumns {
  id: string;
  tenant_id: string;
  enrollment_id: string;
  environment: string;
}

const CANDIDATE_COLUMNS =
  "id, tenant_id, enrollment_id, environment, status, error_origin, created_at, " +
  "opened_at, expires_at, closed_at, id_sesion_sence, zona_horaria, error_codes";

export async function runExpiryTick(
  serviceDb: SupabaseClient,
  cfg: ExpiryTickConfig,
): Promise<ExpiryTickSummary> {
  const batchSize = cfg.batchSize ?? 200;
  const maxBatches = cfg.maxBatches ?? 10;
  const log = cfg.log ?? console;
  const summary = { scanned: 0, expired: { T4: 0, T6: 0, T9: 0 }, raced: 0, failed: 0 };

  // T4: pendientes que superaron el timeout de abandono (índice parcial por
  // created_at). El dominio re-verifica el deadline: la query solo preselecciona.
  const pendingDeadline = new Date(cfg.now - cfg.pendingTimeoutMs).toISOString();
  await sweep(
    () =>
      serviceDb
        .from("sence_sessions")
        .select(CANDIDATE_COLUMNS)
        .eq("status", "iniciada_pendiente")
        .lte("created_at", pendingDeadline)
        .order("created_at", { ascending: true })
        .limit(batchSize),
    summary,
    { serviceDb, cfg, log, batchSize, maxBatches },
  );

  // T6/T9: abiertas o en error-de-cierre que superaron expires_at. El filtro
  // `expires_at is not null` excluye el error terminal de T3 (sin deadline),
  // exactamente como también lo garantiza `expireSession`.
  const nowIso = new Date(cfg.now).toISOString();
  await sweep(
    () =>
      serviceDb
        .from("sence_sessions")
        .select(CANDIDATE_COLUMNS)
        .in("status", ["iniciada", "error"])
        .not("expires_at", "is", null)
        .lte("expires_at", nowIso)
        .order("expires_at", { ascending: true })
        .limit(batchSize),
    summary,
    { serviceDb, cfg, log, batchSize, maxBatches },
  );

  return summary;
}

interface SweepContext {
  serviceDb: SupabaseClient;
  cfg: ExpiryTickConfig;
  log: Pick<Console, "warn" | "error">;
  batchSize: number;
  maxBatches: number;
}

type CandidateQuery = () => PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}>;

async function sweep(
  query: CandidateQuery,
  summary: { scanned: number; expired: Record<TransitionId & ("T4" | "T6" | "T9"), number>; raced: number; failed: number },
  ctx: SweepContext,
): Promise<void> {
  for (let batch = 0; batch < ctx.maxBatches; batch += 1) {
    const { data, error } = await query();
    if (error) {
      ctx.log.error("[sence][worker] fallo leyendo candidatas de expiración", {
        message: error.message,
      });
      summary.failed += 1;
      return;
    }
    const rows = (data ?? []) as ExpiryCandidateRow[];
    // Las filas procesadas salen del predicado (status cambia): re-consultar
    // trae el batch siguiente. Si nada cambió (todo raced/failed), cortar para
    // no re-barrer las mismas filas en un loop infinito.
    let progressed = false;

    for (const row of rows) {
      summary.scanned += 1;
      const outcome = await expireOne(row, ctx);
      if (outcome.kind === "expired") {
        summary.expired[outcome.transition] += 1;
        progressed = true;
      } else if (outcome.kind === "raced") {
        summary.raced += 1;
      } else if (outcome.kind === "failed") {
        summary.failed += 1;
      }
      // "skipped" (el dominio dice que aún no vence): ni cuenta ni progresa.
    }

    if (rows.length < ctx.batchSize) return;
    if (!progressed) {
      ctx.log.warn("[sence][worker] batch sin progreso; se corta el barrido", {
        batch,
        rows: rows.length,
      });
      return;
    }
  }
  ctx.log.warn("[sence][worker] tope de batches alcanzado; quedan candidatas", {
    maxBatches: ctx.maxBatches,
  });
}

type ExpireOutcome =
  | { kind: "expired"; transition: "T4" | "T6" | "T9" }
  | { kind: "raced" }
  | { kind: "skipped" }
  | { kind: "failed" };

async function expireOne(row: ExpiryCandidateRow, ctx: SweepContext): Promise<ExpireOutcome> {
  const state = rowToState(row);
  const result = expireSession(state, {
    now: ctx.cfg.now,
    pendingTimeoutMs: ctx.cfg.pendingTimeoutMs,
  });
  if (!result.changed || result.transition === null) return { kind: "skipped" };
  const transition = result.transition as "T4" | "T6" | "T9";

  // CAS estrecho: solo `status`, condicionado al status leído y al tenant de
  // la fila (H-3). Si un callback ganó la carrera, afecta 0 filas y se descarta.
  const { error, count } = await ctx.serviceDb
    .from("sence_sessions")
    .update({ status: "expirada" }, { count: "exact" })
    .eq("id", row.id)
    .eq("tenant_id", row.tenant_id)
    .eq("status", row.status);
  if (error) {
    ctx.log.error("[sence][worker] fallo expirando sesión", {
      sessionId: row.id,
      message: error.message,
    });
    return { kind: "failed" };
  }
  if (count === 0) return { kind: "raced" };

  // La expiración es una decisión LOCAL (no un callback recibido): se registra
  // en audit_log, no como kind nuevo de sence_events (I-4 clasifica callbacks;
  // decisión D-015). Best-effort: la transición ya es la verdad operativa.
  const { error: auditError } = await ctx.serviceDb.from("audit_log").insert({
    tenant_id: row.tenant_id,
    actor_user_id: null, // acción de sistema (worker), sin actor humano
    action: "sence.session_expired",
    entity: "sence_sessions",
    entity_id: row.id,
    details: {
      transition,
      enrollment_id: row.enrollment_id,
      environment: row.environment,
      created_at: row.created_at,
      expires_at: row.expires_at,
    },
  });
  if (auditError) {
    ctx.log.error("[sence][worker] sesión expirada pero auditoría falló", {
      sessionId: row.id,
      message: auditError.message,
    });
    return { kind: "failed" };
  }
  return { kind: "expired", transition };
}

// ---------------------------------------------------------------------------
// Alerta de tasa de error (misma pasada del tick).
// ---------------------------------------------------------------------------

export interface ErrorRateCheckConfig {
  readonly now: number;
  readonly windowMs: number;
  readonly policy: ErrorRatePolicy;
  /** Sin nueva alerta del mismo kind/tenant dentro del cooldown (default = ventana). */
  readonly cooldownMs?: number;
  readonly log?: Pick<Console, "warn" | "error">;
  /**
   * Canal adicional inyectable (correo al operador vía EmailSender — se cablea
   * cuando exista el proveedor; el worker no conoce el transporte).
   */
  readonly notify?: (alert: {
    tenantId: string;
    message: string;
    rate: number;
    errors: number;
    total: number;
  }) => Promise<void>;
}

export interface ErrorRateCheckSummary {
  /** Tenants que generaron una alerta nueva en esta pasada. */
  readonly alerted: string[];
  /** Tenants sobre el umbral pero silenciados por cooldown. */
  readonly cooledDown: string[];
}

const CALLBACK_KINDS = ["start_ok", "start_error", "close_ok", "close_error"] as const;

export async function runErrorRateCheck(
  serviceDb: SupabaseClient,
  cfg: ErrorRateCheckConfig,
): Promise<ErrorRateCheckSummary> {
  const log = cfg.log ?? console;
  const cooldownMs = cfg.cooldownMs ?? cfg.windowMs;
  const windowStart = new Date(cfg.now - cfg.windowMs).toISOString();

  // Ventana CERRADA [now-window, now]: sin cota superior, un evento con
  // timestamp posterior al tick (reloj desviado, fixtures) contaminaría la tasa.
  const { data, error } = await serviceDb
    .from("sence_events")
    .select("tenant_id, kind")
    .gte("received_at", windowStart)
    .lte("received_at", new Date(cfg.now).toISOString())
    .in("kind", [...CALLBACK_KINDS])
    .not("tenant_id", "is", null);
  if (error) {
    log.error("[sence][worker] fallo leyendo eventos para la tasa de error", {
      message: error.message,
    });
    return { alerted: [], cooledDown: [] };
  }

  const byTenant = new Map<string, { errors: number; total: number }>();
  for (const row of (data ?? []) as { tenant_id: string; kind: string }[]) {
    const agg = byTenant.get(row.tenant_id) ?? { errors: 0, total: 0 };
    agg.total += 1;
    if (row.kind === "start_error" || row.kind === "close_error") agg.errors += 1;
    byTenant.set(row.tenant_id, agg);
  }

  const alerted: string[] = [];
  const cooledDown: string[] = [];
  const windowMinutes = Math.round(cfg.windowMs / 60_000);
  const cooldownStart = new Date(cfg.now - cooldownMs).toISOString();

  for (const [tenantId, sample] of byTenant) {
    const verdict = evaluateErrorRate(sample, cfg.policy);
    if (!verdict.alert) continue;

    const { data: recent, error: recentError } = await serviceDb
      .from("alerts")
      .select("id")
      .eq("kind", "sence_error_rate")
      .eq("tenant_id", tenantId)
      .gte("created_at", cooldownStart)
      .limit(1);
    if (recentError) {
      log.error("[sence][worker] fallo consultando cooldown de alertas", {
        message: recentError.message,
      });
      continue;
    }
    if ((recent ?? []).length > 0) {
      cooledDown.push(tenantId);
      continue;
    }

    const message = errorRateAlertMessage(verdict, sample, windowMinutes);
    const { error: insertError } = await serviceDb.from("alerts").insert({
      tenant_id: tenantId,
      kind: "sence_error_rate",
      severity: "warning",
      message,
      details: {
        rate: Number(verdict.rate.toFixed(4)),
        errors: sample.errors,
        total: sample.total,
        windowMinutes,
      },
      // Estampada con el reloj del tick (no el de la BD): el cooldown compara
      // contra el mismo reloj inyectado, y los tests controlan el tiempo.
      created_at: new Date(cfg.now).toISOString(),
    });
    if (insertError) {
      log.error("[sence][worker] fallo insertando alerta", { message: insertError.message });
      continue;
    }

    // Log estructurado: visible en Coolify aunque no haya canal de correo aún.
    log.error(
      "[sence][alert] " +
        JSON.stringify({
          kind: "sence_error_rate",
          tenantId,
          rate: verdict.rate,
          errors: sample.errors,
          total: sample.total,
          windowMinutes,
        }),
    );
    alerted.push(tenantId);

    if (cfg.notify) {
      try {
        await cfg.notify({
          tenantId,
          message,
          rate: verdict.rate,
          errors: sample.errors,
          total: sample.total,
        });
      } catch (notifyError) {
        log.error("[sence][worker] canal de notificación falló", {
          message: (notifyError as Error).message,
        });
      }
    }
  }

  return { alerted, cooledDown };
}
