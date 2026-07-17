import "server-only";

import { Queue } from "bullmq";
import IORedis from "ioredis";

/**
 * Cliente LIGERO de BullMQ para encolar jobs ONE-OFF desde request handlers /
 * server actions de la app Next (task 5.1a). Usa la MISMA cola ("sence") que
 * consume el worker (`src/worker/index.ts`), así el Worker/processor ya
 * existente la procesa sin wiring adicional — solo se agrega una rama por
 * `job.name` allá.
 *
 * Fail-open REAL (mismo patrón que `src/lib/redis.ts`): sin `REDIS_URL`, o si
 * la conexión falla, `enqueueScormExtract`/`enqueueDescriptorExtract`
 * devuelven `false` SIN lanzar — la subida del paquete/descriptor jamás debe
 * abortar por esto. Los jobs periódicos `scorm-sweep`/`descriptor-sweep` del
 * worker recogen lo que quedó sin encolar.
 */

const QUEUE_NAME = "sence";
const SCORM_EXTRACT_JOB = "scorm-extract";
const DESCRIPTOR_EXTRACT_JOB = "descriptor-extract";

let cachedQueue: Queue | null | undefined;

function getQueue(): Queue | null {
  if (cachedQueue !== undefined) return cachedQueue;
  const url = process.env.REDIS_URL;
  if (!url) {
    cachedQueue = null;
    return null;
  }
  try {
    const connection = new IORedis(url, {
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
      lazyConnect: false,
    });
    // Un error de conexión no debe lanzar: se degrada a fail-open más abajo.
    connection.on("error", () => undefined);
    cachedQueue = new Queue(QUEUE_NAME, { connection });
  } catch {
    cachedQueue = null;
  }
  return cachedQueue;
}

/** Encola la extracción de un paquete SCORM recién subido. NUNCA lanza. */
export async function enqueueScormExtract(packageId: string, tenantId: string): Promise<boolean> {
  const queue = getQueue();
  if (!queue) return false;
  try {
    await queue.add(
      SCORM_EXTRACT_JOB,
      { packageId, tenantId },
      { removeOnComplete: { count: 100 }, removeOnFail: { age: 7 * 24 * 3600, count: 200 } },
    );
    return true;
  } catch {
    return false;
  }
}

/** Encola el procesamiento de un descriptor SENCE (.docx) recién subido al asistente. NUNCA lanza. */
export async function enqueueDescriptorExtract(draftId: string, tenantId: string): Promise<boolean> {
  const queue = getQueue();
  if (!queue) return false;
  try {
    await queue.add(
      DESCRIPTOR_EXTRACT_JOB,
      { draftId, tenantId },
      { removeOnComplete: { count: 100 }, removeOnFail: { age: 7 * 24 * 3600, count: 200 } },
    );
    return true;
  } catch {
    return false;
  }
}
