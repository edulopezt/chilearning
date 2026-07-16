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
import { emailSenderFromEnv } from "../modules/comunicacion/email-sender";
import { n8nEmitterFromEnv } from "../modules/comunicacion/n8n-webhook";
import { runRemindersTick } from "../modules/comunicacion/reminders";

const QUEUE_NAME = "sence";
const TICK_JOB = "sence-tick";
const REMINDERS_JOB = "reminders-tick";

function remindersEveryMs(): number {
  const raw = Number(process.env.REMINDERS_EVERY_MS);
  return Number.isInteger(raw) && raw >= 60_000 ? raw : 60 * 60 * 1000; // default 1 h
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

  const worker = new Worker(
    QUEUE_NAME,
    async (job) => {
      if (job.name === REMINDERS_JOB) await remindersTick(db);
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
