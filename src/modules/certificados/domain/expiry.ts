// ⚠ SIN `import "server-only"`: lo ejecuta también el proceso worker (job
// `expiry-alerts-tick`), que corre fuera de Next (mismo criterio que
// `comunicacion/reminders.ts` y `sence/expiry.ts`).
import { pseudonymize, type N8nEventBase } from "../../comunicacion/domain/automation";

/**
 * Dominio puro de vigencia y recertificación (task 5.12, HU-7.3). Sin IO.
 *
 * Tres reglas, y las tres son delicadas:
 *  1. `computeExpiresAt`: sumar meses con CLAMP de fin de mes (31-ene + 1 mes =
 *     28/29-feb, no 3-mar). `setUTCMonth` desborda solo; hay que corregirlo.
 *  2. `dueOffset`: qué aviso toca HOY, con la regla anti-ráfaga.
 *  3. `buildExpiryN8nEvent`: a n8n SOLO agregado seudonimizado (RNF-10).
 *
 * ⚠ Import RELATIVO a `comunicacion/domain/automation` (no `@/`): el worker
 * bundlea este archivo con esbuild y no resuelve el alias.
 */

export const DEFAULT_EXPIRY_OFFSETS: readonly number[] = [90, 60, 30];

const MIN_OFFSET = 1;
const MAX_OFFSET = 365;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Fecha de vencimiento = emisión + N meses, en UTC, con CLAMP de fin de mes.
 *
 * El clamp es el punto entero de esta función. `Date.setUTCMonth(m+1)` sobre el
 * 31-ene da el 3-mar (desborda al mes siguiente porque febrero no tiene 31), y
 * un certificado emitido el 31 de enero con 1 mes de vigencia vence el 28/29 de
 * febrero — nunca en marzo. Se detecta el desborde comparando el día resultante
 * con el original y se retrocede al último día del mes destino.
 *
 * `validityMonths` null/0/negativo/no entero ⇒ null = no vence (falla CERRADO
 * hacia "no molestar": un dato basura no debe inventar vencimientos).
 */
export function computeExpiresAt(issuedAtIso: string, validityMonths: number | null): string | null {
  if (validityMonths === null || !Number.isInteger(validityMonths) || validityMonths < 1) return null;
  const issued = Date.parse(issuedAtIso);
  if (!Number.isFinite(issued)) return null;

  const d = new Date(issued);
  const day = d.getUTCDate();
  d.setUTCMonth(d.getUTCMonth() + validityMonths);
  // Desbordó al mes siguiente (el día no "cabía"): retrocede al último día del
  // mes destino. Día 0 del mes actual = último día del mes anterior.
  if (d.getUTCDate() !== day) d.setUTCDate(0);
  return d.toISOString();
}

/** Días calendario (UTC) que faltan para el vencimiento; negativo = ya venció. */
export function daysUntil(expiresAtIso: string, nowMs: number): number | null {
  const expires = Date.parse(expiresAtIso);
  if (!Number.isFinite(expires)) return null;
  // Se compara por DÍA (no por instante): "faltan 90 días" es una afirmación de
  // calendario. Sin el truncado, un certificado a 89 d y 23 h daría 89 y otro a
  // 90 d y 1 h daría 90, y el aviso saltaría o no según la hora del tick.
  return Math.floor((expires - nowMs) / DAY_MS);
}

/**
 * Offset que toca notificar HOY, o null si ninguno.
 *
 * REGLA ANTI-RÁFAGA (ruling aprobado): devuelve el MENOR offset ya alcanzado, no
 * el mayor. Si un certificado entra tarde a la ventana (p.ej. aparece a 45 días
 * con offsets 90/60/30), notificar el 90 y el 60 sería una ráfaga de correos por
 * un hecho único; el llamador marca los mayores como enviados SIN notificar y
 * manda UNO solo por el menor pendiente (aquí, 60). El de 30 llegará a su tiempo.
 *
 * Certificado YA VENCIDO (daysLeft < 0) ⇒ null: no se spamea a quien ya perdió
 * la vigencia. El LISTADO sí lo muestra (ahí está la acción del coordinador).
 *
 * `offsetsDesc` debe venir de `sanitizeOffsets` (únicos, desc, 1..365).
 */
export function dueOffset(
  expiresAtIso: string,
  nowMs: number,
  offsetsDesc: readonly number[],
): number | null {
  const daysLeft = daysUntil(expiresAtIso, nowMs);
  if (daysLeft === null || daysLeft < 0) return null;
  // Menor offset que ya se alcanzó: `offsetsDesc` viene descendente, así que el
  // último que cumple `daysLeft <= offset` es el menor de los alcanzados.
  let due: number | null = null;
  for (const offset of offsetsDesc) {
    if (daysLeft <= offset) due = offset;
  }
  return due;
}

/**
 * Offsets que el llamador debe MARCAR como enviados al notificar `due`: el
 * propio `due` y todos los mayores (ya no corresponden — su momento pasó).
 * Insertarlos todos en el ledger es lo que impide la ráfaga en el tick siguiente.
 */
export function offsetsToMark(due: number, offsetsDesc: readonly number[]): number[] {
  return offsetsDesc.filter((o) => o >= due);
}

/**
 * Normaliza los offsets configurados: enteros en 1..365, únicos, DESCENDENTE.
 * Entrada basura o vacía ⇒ el default 90/60/30 de la CA (nunca "sin avisos":
 * un array roto en la config no debe silenciar la recertificación).
 */
export function sanitizeOffsets(raw: unknown): number[] {
  if (!Array.isArray(raw)) return [...DEFAULT_EXPIRY_OFFSETS];
  const clean = [...new Set(
    raw
      .map((v) => (typeof v === "number" ? v : Number(v)))
      .filter((n): n is number => Number.isInteger(n) && n >= MIN_OFFSET && n <= MAX_OFFSET),
  )].sort((a, b) => b - a);
  return clean.length > 0 ? clean : [...DEFAULT_EXPIRY_OFFSETS];
}

/**
 * Evento agregado a n8n por (tenant, curso, offset). SIN PII por construcción:
 * la firma no admite RUN, nombre ni correo — solo ids que se seudonimizan y un
 * conteo (RNF-10). El correo con destinatario real lo manda el worker por
 * `EmailSender`, jamás n8n.
 */
export interface N8nCertExpiryEvent extends N8nEventBase {
  readonly type: "certificate_expiring";
  readonly course: string; // seudónimo
  readonly offsetDays: number;
}

export function buildExpiryN8nEvent(
  secret: string,
  input: { tenantId: string; courseId: string; offsetDays: number; count: number; at: string },
): N8nCertExpiryEvent {
  return {
    type: "certificate_expiring",
    tenant: pseudonymize(secret, input.tenantId),
    course: pseudonymize(secret, input.tenantId, input.courseId),
    offsetDays: input.offsetDays,
    count: input.count,
    at: input.at,
  };
}
