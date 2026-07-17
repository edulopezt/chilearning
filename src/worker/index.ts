/**
 * Worker de jobs (plan §5.6 — task 2.6): proceso aparte, mismo código.
 * v1: un único job repetible `sence-tick` (cada 5 min) que
 *   1. expira sesiones SENCE vencidas (T4/T6/T9 — `runExpiryTick`), y
 *   2. evalúa la tasa de errores SENCE por tenant (`runErrorRateCheck`).
 *
 * El wiring BullMQ es deliberadamente FINO: toda la lógica vive en
 * `src/modules/sence/expiry.ts` (testeable sin Redis). Este archivo solo
 * conecta Redis, programa el job y traduce env → config.
 *
 * Ejecución: `pnpm worker` (dev, con Redis local) o `node dist/worker/index.js`
 * (bundle de esbuild; en Coolify es una segunda app del mismo repo).
 *
 * ⚠ Corre FUERA de Next.js: nada de `server-only`, alias `@/` ni APIs de React.
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { Queue, Worker } from "bullmq";
import IORedis from "ioredis";

import { senceTimingFromEnv } from "../modules/sence/domain/timing";
import { runDay1Check, runErrorRateCheck, runExpiryTick } from "../modules/sence/expiry";
import { runExpiryAlertsTick } from "../modules/certificados/expiry-alerts";
import { emailSenderFromEnv } from "../modules/comunicacion/email-sender";
import { n8nEmitterFromEnv } from "../modules/comunicacion/n8n-webhook";
import { runRemindersTick } from "../modules/comunicacion/reminders";
import { runScormExtract, runScormSweep } from "../modules/contenido/scorm-extract";
import { runTenantExportTick } from "../modules/reportes/tenant-export-runner";

const QUEUE_NAME = "sence";
const TICK_JOB = "sence-tick";
const REMINDERS_JOB = "reminders-tick";
const EXPIRY_JOB = "expiry-alerts-tick";
const TENANT_EXPORT_JOB = "tenant-export-tick";
const SCORM_EXTRACT_JOB = "scorm-extract";
const SCORM_SWEEP_JOB = "scorm-sweep";

function remindersEveryMs(): number {
  const raw = Number(process.env.REMINDERS_EVERY_MS);
  return Number.isInteger(raw) && raw >= 60_000 ? raw : 60 * 60 * 1000; // default 1 h
}

function certExpiryEveryMs(): number {
  const raw = Number(process.env.CERT_EXPIRY_EVERY_MS);
  return Number.isInteger(raw) && raw >= 60_000 ? raw : 6 * 60 * 60 * 1000; // default 6 h
}

function tenantExportEveryMs(): number {
  const raw = Number(process.env.TENANT_EXPORT_EVERY_MS);
  return Number.isInteger(raw) && raw >= 10_000 ? raw : 60 * 1000; // default 60 s: cola manual, hay que reaccionar rápido
}

function scormSweepEveryMs(): number {
  const raw = Number(process.env.SCORM_SWEEP_EVERY_MS);
  return Number.isInteger(raw) && raw >= 60_000 ? raw : 5 * 60 * 1000; // default 5 min
}

/** Índice user_id → {email, name} recorriendo el admin API (para el correo PII). */
async function resolveRecipientsFactory(db: SupabaseClient) {
  return async (userIds: readonly string[]): Promise<Map<string, { email: string; name: string }>> => {
    const want = new Set(userIds);
    const out = new Map<string, { email: string; name: string }>();
    for (let page = 1; page <= 50 && out.size < want.size; page++) {
      const { data, error } = await db.auth.admin.listUsers({ page, perPage: 200 });
      if (error) break;
      const users = data?.users ?? [];
      for (const u of users) {
        if (want.has(u.id) && u.email) {
          const name = (u.user_metadata?.full_name as string | undefined) ?? "";
          out.set(u.id, { email: u.email, name });
        }
      }
      if (users.length < 200) break;
    }
    return out;
  };
}

async function remindersTick(db: SupabaseClient): Promise<void> {
  const startedAt = Date.now();
  const summary = await runRemindersTick(db, {
    now: startedAt,
    secret: process.env.N8N_WEBHOOK_SECRET ?? "unconfigured",
    emailSender: emailSenderFromEnv(process.env),
    n8n: n8nEmitterFromEnv(process.env),
    resolveRecipients: await resolveRecipientsFactory(db),
    inactiveDays: Number(process.env.REMINDERS_INACTIVE_DAYS) || undefined,
    appBaseUrl: process.env.APP_BASE_URL,
  });
  console.log("[worker][reminders] " + JSON.stringify({ tookMs: Date.now() - startedAt, ...summary }));
}

/** Alertas de recertificación (task 5.12, HU-7.3): 90/60/30 días por defecto. */
async function expiryAlertsTick(db: SupabaseClient): Promise<void> {
  const startedAt = Date.now();
  const summary = await runExpiryAlertsTick(db, {
    now: startedAt,
    secret: process.env.N8N_WEBHOOK_SECRET ?? "unconfigured",
    emailSender: emailSenderFromEnv(process.env),
    n8n: n8nEmitterFromEnv(process.env),
    resolveRecipients: await resolveRecipientsFactory(db),
    appBaseUrl: process.env.APP_BASE_URL,
  });
  console.log("[worker][cert-expiry] " + JSON.stringify({ tookMs: Date.now() - startedAt, ...summary }));
}

/** Export completo del tenant en formatos abiertos (task 5.13, HU-1.5): reclama
 *  a lo más UNA solicitud `pending` por tick (concurrency=1 del worker evita
 *  doble-procesamiento; el claim de dos pasos es la segunda capa). */
async function tenantExportTick(db: SupabaseClient): Promise<void> {
  const startedAt = Date.now();
  const summary = await runTenantExportTick(db, {
    emailSender: emailSenderFromEnv(process.env),
    resolveRecipients: await resolveRecipientsFactory(db),
    appBaseUrl: process.env.APP_BASE_URL,
  });
  if (summary.claimed) {
    console.log("[worker][tenant-export] " + JSON.stringify({ tookMs: Date.now() - startedAt, ...summary }));
  }
}

/** Extracción/validación de UN paquete SCORM (task 5.1a, HU-4.2, ADR-006): job
 *  one-off encolado por `src/lib/queue.ts` al subirse el .zip. */
async function scormExtractTick(db: SupabaseClient, data: unknown): Promise<void> {
  const { packageId, tenantId } = (data ?? {}) as { packageId?: unknown; tenantId?: unknown };
  if (typeof packageId !== "string" || typeof tenantId !== "string") {
    console.error("[worker][scorm-extract] job.data inválido", { data });
    return;
  }
  const startedAt = Date.now();
  const result = await runScormExtract(db, { packageId, tenantId, now: startedAt });
  console.log("[worker][scorm-extract] " + JSON.stringify({ tookMs: Date.now() - startedAt, packageId, ...result }));
}

/** Red de seguridad periódica: paquetes `uploaded` sin encolar y `processing` huérfanos. */
async function scormSweepTick(db: SupabaseClient): Promise<void> {
  const startedAt = Date.now();
  const summary = await runScormSweep(db, { now: startedAt });
  if (summary.reprocessed > 0) {
    console.log("[worker][scorm-sweep] " + JSON.stringify({ tookMs: Date.now() - startedAt, ...summary }));
  }
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) {
    // El worker aborta al arrancar si falta config esencial: mejor un crash
    // visible en Coolify que un proceso "vivo" que no expira nada.
    console.error(`[worker] falta la variable de entorno ${name}; abortando`);
    process.exit(1);
  }
  return value;
}

function buildServiceClient(): SupabaseClient {
  const url = process.env.SUPABASE_URL ?? requiredEnv("NEXT_PUBLIC_SUPABASE_URL");
  const key = requiredEnv("SUPABASE_SERVICE_ROLE_KEY");
  return createClient(url, key, { auth: { persistSession: false } });
}

async function tick(db: SupabaseClient): Promise<void> {
  const startedAt = Date.now();
  const timing = senceTimingFromEnv(process.env);
  if (timing.invalidKeys.length > 0) {
    console.warn("[worker] env de timing inválida; se usan defaults", {
      keys: timing.invalidKeys,
    });
  }

  const expiry = await runExpiryTick(db, {
    now: startedAt,
    pendingTimeoutMs: timing.pendingTimeoutMs,
  });
  const alerts = await runErrorRateCheck(db, {
    now: startedAt,
    windowMs: timing.alertWindowMs,
    policy: {
      threshold: timing.alertErrorRateThreshold,
      minEvents: timing.alertMinEvents,
    },
  });
  // Fase 3 (task 2.7): alerta temprana de asistencia baja el día 1.
  const day1 = await runDay1Check(db, {
    now: startedAt,
    threshold: timing.day1AttendanceThreshold,
    evalHourLocal: timing.day1EvalHour,
  });

  // Una línea JSON por tick: los logs de Coolify son la observabilidad v1.
  console.log(
    "[worker][tick] " +
      JSON.stringify({
        tookMs: Date.now() - startedAt,
        expiry,
        alerts,
        day1,
      }),
  );
}

async function main(): Promise<void> {
  const redisUrl = requiredEnv("REDIS_URL");
  // Mismo parseo defensivo que el resto de knobs (revisión R-3): un valor
  // inválido (negativo, fraccionario) rompía el scheduling de BullMQ en silencio.
  const { tickEveryMs } = senceTimingFromEnv(process.env);
  const db = buildServiceClient();

  // BullMQ exige `maxRetriesPerRequest: null` en la conexión de Workers.
  const connection = new IORedis(redisUrl, { maxRetriesPerRequest: null });
  connection.on("error", (err) => {
    console.error("[worker] error de conexión Redis", { message: err.message });
  });

  const queue = new Queue(QUEUE_NAME, { connection });
  // Idempotente entre despliegues: actualiza (no duplica) el scheduler. Con
  // poda de jobs terminados (revisión R-6): sin removeOn*, BullMQ conserva
  // TODO el historial (288 jobs/día para siempre) en un Redis noeviction.
  await queue.upsertJobScheduler(
    TICK_JOB,
    { every: tickEveryMs },
    {
      name: TICK_JOB,
      opts: {
        removeOnComplete: { count: 100 },
        removeOnFail: { age: 7 * 24 * 3600, count: 500 },
      },
    },
  );
  // Recordatorios periféricos (task 3.9): job aparte, cadencia horaria (la dedup
  // diaria en la outbox evita reenvíos aunque corra seguido).
  await queue.upsertJobScheduler(
    REMINDERS_JOB,
    { every: remindersEveryMs() },
    { name: REMINDERS_JOB, opts: { removeOnComplete: { count: 50 }, removeOnFail: { age: 7 * 24 * 3600, count: 200 } } },
  );
  // Vencimientos de certificados (task 5.12): cadencia de HORAS, no de minutos —
  // la ventana es de días y el ledger `(certificate_id, offset_days)` deduplica,
  // así que correr seguido no reenvía; solo gastaría consultas.
  await queue.upsertJobScheduler(
    EXPIRY_JOB,
    { every: certExpiryEveryMs() },
    { name: EXPIRY_JOB, opts: { removeOnComplete: { count: 50 }, removeOnFail: { age: 7 * 24 * 3600, count: 200 } } },
  );
  // Export completo del tenant (task 5.13): cola MANUAL (el admin pide un
  // export), así que la cadencia por defecto es corta (60 s) para no hacerlo
  // esperar; el índice único parcial de `tenant_exports` garantiza que a lo
  // más UNO por tenant está `pending`/`running` a la vez.
  await queue.upsertJobScheduler(
    TENANT_EXPORT_JOB,
    { every: tenantExportEveryMs() },
    { name: TENANT_EXPORT_JOB, opts: { removeOnComplete: { count: 50 }, removeOnFail: { age: 7 * 24 * 3600, count: 200 } } },
  );
  // Red de seguridad de la ingesta SCORM (task 5.1a): recoge `uploaded` sin
  // encolar (Redis caído al subir) y `processing` huérfanos (worker murió a
  // medias). El job one-off `scorm-extract` lo encola `src/lib/queue.ts` al
  // subirse cada paquete — este scheduler es SOLO el barrido periódico.
  await queue.upsertJobScheduler(
    SCORM_SWEEP_JOB,
    { every: scormSweepEveryMs() },
    { name: SCORM_SWEEP_JOB, opts: { removeOnComplete: { count: 50 }, removeOnFail: { age: 7 * 24 * 3600, count: 200 } } },
  );

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === REMINDERS_JOB) await remindersTick(db);
      else if (job.name === EXPIRY_JOB) await expiryAlertsTick(db);
      else if (job.name === TENANT_EXPORT_JOB) await tenantExportTick(db);
      else if (job.name === SCORM_EXTRACT_JOB) await scormExtractTick(db, job.data);
      else if (job.name === SCORM_SWEEP_JOB) await scormSweepTick(db);
      else await tick(db);
    },
    { connection, concurrency: 1 },
  );
  worker.on("failed", (_job, err) => {
    console.error("[worker] tick falló", { message: err.message });
  });

  console.log(
    "[worker] arriba " +
      JSON.stringify({ queue: QUEUE_NAME, job: TICK_JOB, everyMs: tickEveryMs }),
  );

  const shutdown = async (signal: string): Promise<void> => {
    console.log(`[worker] ${signal} recibido; cerrando limpio`);
    await worker.close();
    await queue.close();
    connection.disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
  process.on("SIGINT", () => void shutdown("SIGINT"));
}

void main();
