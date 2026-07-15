import "server-only";

import { randomBytes } from "node:crypto";

import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import {
  validateEnrollmentCsv,
  type ImportReport,
  type ValidEnrollmentRow,
} from "@/modules/academico/domain/enrollment-import";

/**
 * Servicio de import de inscripciones (task 1.3). Toma el reporte del validador
 * de dominio e inserta SOLO las filas válidas, vía service-role bajo
 * `tenantGuard()`. Idempotente: reusar usuarios existentes, no duplicar
 * membresías (sin pisar roles previos), upsert de la inscripción. "Sin insertar
 * basura": las filas inválidas nunca llegan aquí (gate F1).
 */

export interface ImportOutcome {
  /** Filas válidas efectivamente inscritas (nuevas o actualizadas). */
  imported: number;
  /** Filas válidas que no se pudieron inscribir, con su motivo. */
  failed: { rowNumber: number; reason: string }[];
  /** Reporte de validación (filas rechazadas por formato, fila a fila). */
  report: ImportReport;
}

export type ImportError = "forbidden" | "no_tenant" | "action_not_found";

/** Password aleatorio de un solo uso: el alumno accederá por magic link (1.9). */
function throwawayPassword(): string {
  return `${randomBytes(24).toString("base64url")}aA1!`;
}

/**
 * Valida el CSV y, si el actor tiene permiso, inscribe las filas válidas en la
 * acción indicada. No aborta el lote si una fila falla al escribir: la reporta.
 */
export async function importEnrollmentsFromCsv(
  principal: Principal,
  actionId: string,
  csvText: string,
): Promise<ImportOutcome | { error: ImportError }> {
  if (!principal.tenantId) return { error: "no_tenant" };
  // Matriz §3: AdminOTEC (CRUD) y Coordinador (CRU) gestionan usuarios/inscripciones.
  if (!authorize(principal, principal.tenantId, ["otec_admin", "coordinator"])) {
    return { error: "forbidden" };
  }

  const guard = tenantGuard(principal.tenantId);

  // La acción debe existir y pertenecer al tenant del actor (aislamiento).
  const { data: action } = await guard
    .from("actions")
    .select("id")
    .eq("id", actionId)
    .maybeSingle();
  if (!action) return { error: "action_not_found" };

  const report = validateEnrollmentCsv(csvText);
  const failed: ImportOutcome["failed"] = [];
  let imported = 0;

  const emailToUserId = await buildEmailIndex(guard.db);

  for (const row of report.valid) {
    try {
      const userId = await ensureUser(guard.db, emailToUserId, row);
      await ensureMembership(guard, userId);
      await upsertEnrollment(guard, actionId, userId, row);
      imported++;
    } catch (err) {
      failed.push({ rowNumber: row.rowNumber, reason: reason(err) });
    }
  }

  return { imported, failed, report };
}

function reason(err: unknown): string {
  if (err instanceof Error) return err.message;
  return "Error desconocido al inscribir la fila.";
}

/** Índice email→user_id recorriendo las páginas del admin API (idempotencia). */
async function buildEmailIndex(db: ReturnType<typeof tenantGuard>["db"]): Promise<Map<string, string>> {
  const index = new Map<string, string>();
  const perPage = 200;
  for (let page = 1; page <= 50; page++) {
    const { data, error } = await db.auth.admin.listUsers({ page, perPage });
    if (error) break;
    const users = data?.users ?? [];
    for (const u of users) {
      if (u.email) index.set(u.email.toLowerCase(), u.id);
    }
    if (users.length < perPage) break;
  }
  return index;
}

/** Devuelve el user_id del alumno, creándolo si no existe (por email). */
async function ensureUser(
  db: ReturnType<typeof tenantGuard>["db"],
  emailToUserId: Map<string, string>,
  row: ValidEnrollmentRow,
): Promise<string> {
  const key = row.email.toLowerCase();
  const existing = emailToUserId.get(key);
  if (existing) return existing;

  const { data, error } = await db.auth.admin.createUser({
    email: row.email,
    email_confirm: true,
    password: throwawayPassword(),
    user_metadata: { full_name: row.nombre },
  });
  if (error || !data?.user) {
    throw new Error(`No se pudo crear el usuario ${row.email}: ${error?.message ?? "sin id"}`);
  }
  emailToUserId.set(key, data.user.id);
  return data.user.id;
}

/** Inserta la membresía de alumno SIN pisar roles existentes (idempotente). */
async function ensureMembership(guard: ReturnType<typeof tenantGuard>, userId: string): Promise<void> {
  const { error } = await guard.db.from("memberships").upsert(
    guard.withTenant({ user_id: userId, roles: ["student"], status: "active" }),
    { onConflict: "tenant_id,user_id", ignoreDuplicates: true },
  );
  if (error) throw new Error(`Membresía: ${error.message}`);
}

/** Upsert de la inscripción (re-import actualiza RUN/exento, no duplica). */
async function upsertEnrollment(
  guard: ReturnType<typeof tenantGuard>,
  actionId: string,
  userId: string,
  row: ValidEnrollmentRow,
): Promise<void> {
  const { error } = await guard.db.from("enrollments").upsert(
    guard.withTenant({ action_id: actionId, user_id: userId, run: row.run, exento: row.exento }),
    { onConflict: "action_id,user_id" },
  );
  if (error) throw new Error(`Inscripción: ${error.message}`);
}
