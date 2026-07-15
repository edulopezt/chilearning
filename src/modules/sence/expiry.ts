import type { SupabaseClient } from "@supabase/supabase-js";

import {
  errorRateAlertMessage,
  evaluateErrorRate,
  type ErrorRatePolicy,
} from "./domain/alerts";
import { day1AlertMessage, evaluateDay1, localHour, localIsoDate } from "./domain/day1";
import { expireSession, rowToState, type SessionStateColumns } from "./domain/session";

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
  /** Expiradas cuya fila de audit_log falló (revisión R-5): la transición SÍ
   *  ocurrió (cuenta en `expired`) pero el renglón de auditoría se perdió; el
   *  log lleva el sessionId para backfill manual. */
  readonly unaudited: number;
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
  const summary = {
    scanned: 0,
    expired: { T4: 0, T6: 0, T9: 0 },
    raced: 0,
    failed: 0,
    unaudited: 0,
  };

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

interface MutableSummary {
  scanned: number;
  expired: Record<"T4" | "T6" | "T9", number>;
  raced: number;
  failed: number;
  unaudited: number;
}

type CandidateQuery = () => PromiseLike<{
  data: unknown;
  error: { message: string } | null;
}>;

async function sweep(query: CandidateQuery, summary: MutableSummary, ctx: SweepContext): Promise<void> {
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
      if (outcome.kind === "expired" || outcome.kind === "expired_unaudited") {
        // Ambas cuentan como expiración Y como progreso (revisión R-5): la fila
        // salió del predicado aunque la auditoría haya fallado; sin esto un
        // fallo sistemático de audit_log cortaba el barrido como "sin progreso".
        summary.expired[outcome.transition] += 1;
        if (outcome.kind === "expired_unaudited") summary.unaudited += 1;
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
  | { kind: "expired_unaudited"; transition: "T4" | "T6" | "T9" }
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
    // La transición ya commiteó (es la verdad operativa; la fila conserva todos
    // los campos del registro perdido). Se reporta con sessionId para backfill.
    ctx.log.error("[sence][worker] sesión expirada pero auditoría falló", {
      sessionId: row.id,
      message: auditError.message,
    });
    return { kind: "expired_unaudited", transition };
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
    environment: string;
    message: string;
    rate: number;
    errors: number;
    total: number;
  }) => Promise<void>;
}

/** Grupo tenant×ambiente evaluado (revisión R-2: rcetest y rce no se mezclan). */
export interface ErrorRateGroup {
  readonly tenantId: string;
  readonly environment: string;
}

export interface ErrorRateCheckSummary {
  /** Grupos tenant×ambiente que generaron una alerta nueva en esta pasada. */
  readonly alerted: ErrorRateGroup[];
  /** Grupos sobre el umbral pero silenciados por cooldown. */
  readonly cooledDown: ErrorRateGroup[];
}

const CALLBACK_KINDS = ["start_ok", "start_error", "close_ok", "close_error"] as const;
const EVENTS_PAGE_SIZE = 1000;
const EVENTS_MAX_PAGES = 20;

interface EventPageRow {
  tenant_id: string;
  kind: string;
  session: { environment: string } | null;
}

export async function runErrorRateCheck(
  serviceDb: SupabaseClient,
  cfg: ErrorRateCheckConfig,
): Promise<ErrorRateCheckSummary> {
  const log = cfg.log ?? console;
  const cooldownMs = cfg.cooldownMs ?? cfg.windowMs;
  const windowStart = new Date(cfg.now - cfg.windowMs).toISOString();
  const nowIso = new Date(cfg.now).toISOString();

  // Ventana CERRADA [now-window, now] (sin cota superior, un evento con reloj
  // desviado contaminaría la tasa) y PAGINADA (revisión R-1: PostgREST trunca
  // en max_rows=1000 en silencio; sin paginar, la tasa se calculaba sobre una
  // muestra arbitraria bajo carga — justo durante el incidente que debe
  // detectar). Join a la sesión para separar rcetest de rce (revisión R-2:
  // el tráfico de prueba no debe disparar alertas "de producción" ni al revés;
  // I-11 sanciona ambos ambientes conviviendo en el mismo tenant).
  const rows: EventPageRow[] = [];
  for (let page = 0; page < EVENTS_MAX_PAGES; page += 1) {
    const from = page * EVENTS_PAGE_SIZE;
    const { data, error } = await serviceDb
      .from("sence_events")
      .select("tenant_id, kind, session:sence_sessions!inner(environment)")
      .gte("received_at", windowStart)
      .lte("received_at", nowIso)
      .in("kind", [...CALLBACK_KINDS])
      .not("tenant_id", "is", null)
      .order("received_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, from + EVENTS_PAGE_SIZE - 1);
    if (error) {
      log.error("[sence][worker] fallo leyendo eventos para la tasa de error", {
        message: error.message,
      });
      return { alerted: [], cooledDown: [] };
    }
    const batch = (data ?? []) as unknown as EventPageRow[];
    rows.push(...batch);
    if (batch.length < EVENTS_PAGE_SIZE) break;
    if (page === EVENTS_MAX_PAGES - 1) {
      log.warn("[sence][worker] ventana de tasa de error truncada por tope de páginas", {
        maxRows: EVENTS_MAX_PAGES * EVENTS_PAGE_SIZE,
      });
    }
  }

  const byGroup = new Map<string, { errors: number; total: number }>();
  for (const row of rows) {
    const environment = row.session?.environment;
    if (!environment) continue; // sin sesión correlacionada no hay ambiente
    const key = `${row.tenant_id}|${environment}`;
    const agg = byGroup.get(key) ?? { errors: 0, total: 0 };
    agg.total += 1;
    if (row.kind === "start_error" || row.kind === "close_error") agg.errors += 1;
    byGroup.set(key, agg);
  }

  const alerted: ErrorRateGroup[] = [];
  const cooledDown: ErrorRateGroup[] = [];
  const windowMinutes = Math.round(cfg.windowMs / 60_000);
  const cooldownStart = new Date(cfg.now - cooldownMs).toISOString();

  for (const [key, sample] of byGroup) {
    const [tenantId, environment] = key.split("|") as [string, string];
    const verdict = evaluateErrorRate(sample, cfg.policy);
    if (!verdict.alert) continue;

    // Cooldown por tenant×ambiente: una alerta de rcetest no silencia una de rce.
    const { data: recent, error: recentError } = await serviceDb
      .from("alerts")
      .select("id")
      .eq("kind", "sence_error_rate")
      .eq("tenant_id", tenantId)
      .eq("details->>environment", environment)
      .gte("created_at", cooldownStart)
      .lte("created_at", nowIso)
      .limit(1);
    if (recentError) {
      log.error("[sence][worker] fallo consultando cooldown de alertas", {
        message: recentError.message,
      });
      continue;
    }
    if ((recent ?? []).length > 0) {
      cooledDown.push({ tenantId, environment });
      continue;
    }

    const message = errorRateAlertMessage(verdict, sample, windowMinutes, environment);
    const { error: insertError } = await serviceDb.from("alerts").insert({
      tenant_id: tenantId,
      kind: "sence_error_rate",
      severity: "warning",
      message,
      details: {
        environment,
        rate: Number(verdict.rate.toFixed(4)),
        errors: sample.errors,
        total: sample.total,
        windowMinutes,
      },
      // Estampada con el reloj del tick (no el de la BD): el cooldown compara
      // contra el mismo reloj inyectado, y los tests controlan el tiempo.
      created_at: nowIso,
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
          environment,
          rate: verdict.rate,
          errors: sample.errors,
          total: sample.total,
          windowMinutes,
        }),
    );
    alerted.push({ tenantId, environment });

    if (cfg.notify) {
      try {
        await cfg.notify({
          tenantId,
          environment,
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

// ---------------------------------------------------------------------------
// Alerta temprana de asistencia del DÍA 1 (task 2.7, HU-5.8) — fase 3 del tick.
// ---------------------------------------------------------------------------

export interface Day1CheckConfig {
  readonly now: number;
  /** Umbral 0..1: alerta si `ratio < threshold` (borde EXCLUSIVO). */
  readonly threshold: number;
  /** Hora local desde la que se evalúa (dar tiempo a la primera jornada). */
  readonly evalHourLocal: number;
  readonly timeZone?: string;
  /** Sin nueva alerta de la misma acción dentro del cooldown (default 24 h). */
  readonly cooldownMs?: number;
  readonly log?: Pick<Console, "warn" | "error">;
}

export interface Day1CheckSummary {
  /** `codigo_accion` de las acciones alertadas en esta pasada. */
  readonly alerted: string[];
  readonly cooledDown: string[];
  /** Acciones que parten hoy y fueron evaluadas (con inscritos no exentos). */
  readonly evaluated: number;
}

interface Day1SessionRow {
  enrollment_id: string;
  created_at: string;
}

export async function runDay1Check(
  serviceDb: SupabaseClient,
  cfg: Day1CheckConfig,
): Promise<Day1CheckSummary> {
  const log = cfg.log ?? console;
  const tz = cfg.timeZone ?? "America/Santiago";
  const cooldownMs = cfg.cooldownMs ?? 24 * 3_600_000;

  // Antes de la hora de corte no se evalúa: el peor falso positivo sería
  // alertar a las 8 AM cuando la jornada aún no parte.
  if (localHour(cfg.now, tz) < cfg.evalHourLocal) {
    return { alerted: [], cooledDown: [], evaluated: 0 };
  }

  const today = localIsoDate(cfg.now, tz);
  const nowIso = new Date(cfg.now).toISOString();

  // Acciones (cross-tenant, mismo precedente del barrido) que PARTEN hoy.
  const { data: actionsData, error: actionsError } = await serviceDb
    .from("actions")
    .select("id, tenant_id, codigo_accion")
    .eq("starts_on", today);
  if (actionsError) {
    log.error("[sence][worker] fallo leyendo acciones para día-1", {
      message: actionsError.message,
    });
    return { alerted: [], cooledDown: [], evaluated: 0 };
  }
  const actions = (actionsData ?? []) as {
    id: string;
    tenant_id: string;
    codigo_accion: string;
  }[];

  const alerted: string[] = [];
  const cooledDown: string[] = [];
  let evaluated = 0;

  for (const action of actions) {
    // Inscritos no exentos de la acción (los exentos no registran SENCE, I-14).
    const { count: enrolledNonExempt, error: enrError } = await serviceDb
      .from("enrollments")
      .select("id", { count: "exact", head: true })
      .eq("action_id", action.id)
      .eq("exento", false);
    if (enrError) {
      log.error("[sence][worker] fallo leyendo inscritos para día-1", {
        message: enrError.message,
      });
      continue;
    }
    if (!enrolledNonExempt) continue; // sin inscritos no exentos no hay que alertar

    evaluated += 1;

    // Sesiones de HOY (iniciada o cerrada) de inscritos no exentos de la acción.
    // Join embebido (NUNCA `.in()` con la lista de ids: "URI too long" con
    // cohortes grandes — lección del PR #32) y PAGINADO (revisión R-5 del
    // PR #33: PostgREST capa CUALQUIER limit en max_rows=1000 en silencio;
    // sin paginar, la cohorte grande subcontaba y disparaba una falsa alerta
    // justo donde más duele). Ventana de 26 h (no 24: el día del cambio de
    // hora chileno dura 25 h — revisión R-6); el filtro fino por día LOCAL se
    // hace en JS con localIsoDate.
    const windowStart = new Date(cfg.now - 26 * 3_600_000).toISOString();
    const sessions: Day1SessionRow[] = [];
    let sessError: { message: string } | null = null;
    for (let page = 0; page < EVENTS_MAX_PAGES; page += 1) {
      const from = page * EVENTS_PAGE_SIZE;
      const { data, error } = await serviceDb
        .from("sence_sessions")
        .select("enrollment_id, created_at, enrollments!inner(action_id, exento)")
        .eq("enrollments.action_id", action.id)
        .eq("enrollments.exento", false)
        .in("status", ["iniciada", "cerrada"])
        .gte("created_at", windowStart)
        .lte("created_at", nowIso)
        .order("created_at", { ascending: true })
        .order("id", { ascending: true })
        .range(from, from + EVENTS_PAGE_SIZE - 1);
      if (error) {
        sessError = error;
        break;
      }
      const batch = (data ?? []) as unknown as Day1SessionRow[];
      sessions.push(...batch);
      if (batch.length < EVENTS_PAGE_SIZE) break;
      if (page === EVENTS_MAX_PAGES - 1) {
        log.warn("[sence][worker] sesiones de día-1 truncadas por tope de páginas", {
          codigoAccion: action.codigo_accion,
          maxRows: EVENTS_MAX_PAGES * EVENTS_PAGE_SIZE,
        });
      }
    }
    if (sessError) {
      log.error("[sence][worker] fallo leyendo sesiones para día-1", {
        message: sessError.message,
      });
      continue;
    }
    const withSessionToday = new Set(
      sessions
        .filter((r) => localIsoDate(Date.parse(r.created_at), tz) === today)
        .map((r) => r.enrollment_id),
    ).size;

    const verdict = evaluateDay1({ enrolledNonExempt, withSessionToday }, cfg.threshold);
    if (!verdict.alert) continue;

    // Cooldown por acción (una alerta de día-1 al día).
    const { data: recent, error: recentError } = await serviceDb
      .from("alerts")
      .select("id")
      .eq("kind", "sence_day1_low_attendance")
      .eq("action_id", action.id)
      .gte("created_at", new Date(cfg.now - cooldownMs).toISOString())
      .lte("created_at", nowIso)
      .limit(1);
    if (recentError) {
      log.error("[sence][worker] fallo consultando cooldown de día-1", {
        message: recentError.message,
      });
      continue;
    }
    if ((recent ?? []).length > 0) {
      cooledDown.push(action.codigo_accion);
      continue;
    }

    const message = day1AlertMessage(
      verdict,
      { enrolledNonExempt, withSessionToday },
      action.codigo_accion,
    );
    const { error: insertError } = await serviceDb.from("alerts").insert({
      tenant_id: action.tenant_id,
      kind: "sence_day1_low_attendance",
      severity: "warning",
      message,
      action_id: action.id,
      details: {
        date: today,
        ratio: Number(verdict.ratio.toFixed(4)),
        enrolledNonExempt,
        withSessionToday,
      },
      created_at: nowIso,
    });
    if (insertError) {
      log.error("[sence][worker] fallo insertando alerta de día-1", {
        message: insertError.message,
      });
      continue;
    }
    log.error(
      "[sence][alert] " +
        JSON.stringify({
          kind: "sence_day1_low_attendance",
          tenantId: action.tenant_id,
          codigoAccion: action.codigo_accion,
          ratio: verdict.ratio,
          enrolledNonExempt,
          withSessionToday,
        }),
    );
    alerted.push(action.codigo_accion);
  }

  return { alerted, cooledDown, evaluated };
}
