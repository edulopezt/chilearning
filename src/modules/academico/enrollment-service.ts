import "server-only";

import { randomBytes } from "node:crypto";

import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import {
  validateEnrollmentCsv,
  type ImportReport,
  type ValidEnrollmentRow,
} from "@/modules/academico/domain/enrollment-import";
import { enrollmentGroupLabel } from "@/modules/academico/domain/enrollment-group";
import { emailSenderFromEnv, type EmailSender } from "@/modules/comunicacion/email-sender";
import { renderWelcomeEmail } from "@/modules/comunicacion/domain/email-templates";

/**
 * Servicio de import de inscripciones (task 1.3). Toma el reporte del validador
 * de dominio e inserta SOLO las filas válidas, vía service-role bajo
 * `tenantGuard()`. Idempotente: reusar usuarios existentes, no duplicar
 * membresías (sin pisar roles previos), upsert de la inscripción. "Sin insertar
 * basura": las filas inválidas nunca llegan aquí (gate F1).
 *
 * Hito 2 (cierra el follow-up de 1.6): a cada inscripción NUEVA se le envía el
 * correo de bienvenida con la guía Clave Única, vía `EmailSender` (Resend).
 * Best-effort: un correo fallido NO invalida la inscripción (se cuenta y se
 * audita). Volúmenes grandes → mover a la cola BullMQ (follow-up anotado).
 */

export interface ImportEmailSummary {
  /** Correos de bienvenida enviados (solo inscripciones nuevas). */
  sent: number;
  /** Envíos intentados que fallaron (proveedor caído, dirección inválida). */
  failed: number;
  /** Inscripciones nuevas SIN envío (proveedor no configurado o sin contexto). */
  skipped: number;
}

export interface ImportOutcome {
  /** Filas válidas efectivamente inscritas (nuevas o actualizadas). */
  imported: number;
  /** Filas válidas que no se pudieron inscribir, con su motivo. */
  failed: { rowNumber: number; reason: string }[];
  /** Reporte de validación (filas rechazadas por formato, fila a fila). */
  report: ImportReport;
  /** Resumen del envío de bienvenidas (HU-3.3). */
  emails: ImportEmailSummary;
  /** Desglose por grupo operativo del OTEC (HU-2.2): alumnos SENCE vs becarios. */
  groups: {
    /** Inscritos que marcan SENCE (no exentos). */
    sence: number;
    /** Inscritos exentos (grupo Becario, I-14). */
    becario: number;
    /** Etiqueta del grupo SENCE (`Sence-<código del curso>`) o null si el curso no tiene código. */
    senceLabel: string | null;
  };
}

export interface ImportDeps {
  /** Inyectable en tests; default: Resend según env (no-op sin API key). */
  emailSender?: EmailSender;
  /** URL absoluta a /mi-curso en el host del tenant (la calcula la capa app,
   *  que conoce el request). Sin ella no se envían correos. */
  courseUrl?: string;
}

export type ImportError = "forbidden" | "no_tenant" | "action_not_found" | "action_not_active";

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
  deps: ImportDeps = {},
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
    .select("id, course_id, status, course:courses(cod_sence)")
    .eq("id", actionId)
    .maybeSingle();
  if (!action) return { error: "action_not_found" };
  // Solo se inscribe en acciones ACTIVAS (task 2.8): una acción en borrador aún
  // no tiene código/fechas confirmados ante SENCE.
  if (action.status !== "active") return { error: "action_not_active" };

  // Código SENCE del curso destino: valida el grupo `Sence-<código>` de la
  // planilla (HU-2.2) — una planilla de otro curso se rechaza fila a fila.
  const courseRel = action.course as { cod_sence?: string | null } | { cod_sence?: string | null }[] | null;
  const actionCodSence =
    (Array.isArray(courseRel) ? courseRel[0]?.cod_sence : courseRel?.cod_sence) ?? null;

  const report = validateEnrollmentCsv(csvText, { actionCodSence });
  const failed: ImportOutcome["failed"] = [];
  const emails: ImportEmailSummary = { sent: 0, failed: 0, skipped: 0 };
  const groups: ImportOutcome["groups"] = {
    sence: 0,
    becario: 0,
    senceLabel: enrollmentGroupLabel(false, actionCodSence),
  };
  let imported = 0;

  const emailToUserId = await buildEmailIndex(guard.db);
  const sender = deps.emailSender ?? emailSenderFromEnv(process.env);
  const welcome = await buildWelcomeContext(guard, action.course_id as string, deps.courseUrl);

  for (const row of report.valid) {
    try {
      const userId = await ensureUser(guard.db, emailToUserId, row);
      await ensureMembership(guard, userId);
      const isNew = await upsertEnrollment(guard, actionId, userId, row);
      imported++;
      if (row.exento) groups.becario++;
      else groups.sence++;
      if (isNew) {
        await sendWelcome(sender, welcome, row, emails);
      }
    } catch (err) {
      failed.push({ rowNumber: row.rowNumber, reason: reason(err) });
    }
  }

  // Auditoría del lote de correos (P8; sin direcciones, solo conteos).
  if (emails.sent + emails.failed + emails.skipped > 0) {
    const { error: auditError } = await guard.db.from("audit_log").insert(
      guard.withTenant({
        actor_user_id: principal.userId,
        action: "email.welcome_batch",
        entity: "actions",
        entity_id: actionId,
        details: { ...emails },
      }),
    );
    if (auditError) {
      // Nunca silencioso: la auditoría es parte del contrato (P8).
      console.error("[import] auditoría del lote de correos falló", {
        message: auditError.message,
      });
    }
  }

  return { imported, failed, report, emails, groups };
}

interface WelcomeContext {
  courseName: string;
  courseUrl: string | null;
  brand: { orgName: string; primaryColor: string };
}

/** Contexto del correo de bienvenida (curso + marca), leído UNA vez por lote. */
async function buildWelcomeContext(
  guard: ReturnType<typeof tenantGuard>,
  courseId: string,
  courseUrl: string | undefined,
): Promise<WelcomeContext> {
  const [{ data: course }, { data: tenant }] = await Promise.all([
    guard.db
      .from("courses")
      .select("name")
      .eq("id", courseId)
      .eq("tenant_id", guard.tenantId)
      .maybeSingle(),
    guard.db
      .from("tenants")
      .select("name, branding")
      .eq("id", guard.tenantId)
      .maybeSingle(),
  ]);
  const branding = (tenant?.branding ?? {}) as Record<string, unknown>;
  return {
    courseName: (course?.name as string) ?? "tu curso",
    courseUrl: courseUrl ?? null,
    brand: {
      orgName: (tenant?.name as string) ?? "Tu OTEC",
      // Las plantillas ya validan el hex y caen a su default si no calza.
      primaryColor: typeof branding.primaryColor === "string" ? branding.primaryColor : "#1e3a8a",
    },
  };
}

/** Envía la bienvenida best-effort y actualiza el resumen (nunca lanza). */
async function sendWelcome(
  sender: EmailSender,
  ctx: WelcomeContext,
  row: ValidEnrollmentRow,
  emails: ImportEmailSummary,
): Promise<void> {
  if (!ctx.courseUrl || !sender.configured) {
    emails.skipped++;
    return;
  }
  const rendered = renderWelcomeEmail({
    brand: ctx.brand,
    recipientName: row.nombre,
    courseName: ctx.courseName,
    courseUrl: ctx.courseUrl,
  });
  const result = await sender.send({
    to: row.email,
    subject: rendered.subject,
    html: rendered.html,
    text: rendered.text,
  });
  if (result.ok) emails.sent++;
  else emails.failed++;
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
    user_metadata: { full_name: `${row.nombre} ${row.apellidos}`.trim() },
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

/** Upsert de la inscripción (re-import actualiza RUN/exento, no duplica).
 *  Devuelve `true` si la inscripción es NUEVA (gatilla la bienvenida). */
async function upsertEnrollment(
  guard: ReturnType<typeof tenantGuard>,
  actionId: string,
  userId: string,
  row: ValidEnrollmentRow,
): Promise<boolean> {
  const { data: existing } = await guard.db
    .from("enrollments")
    .select("id")
    .eq("tenant_id", guard.tenantId)
    .eq("action_id", actionId)
    .eq("user_id", userId)
    .maybeSingle();

  const { error } = await guard.db.from("enrollments").upsert(
    guard.withTenant({
      action_id: actionId,
      user_id: userId,
      run: row.run,
      exento: row.exento,
      // Snapshot para reportes SENCE (NOMBRES/APELLIDOS del export, task 2.4).
      // Jamás se parte un nombre: sin columna apellidos, last_names queda NULL.
      first_names: row.nombre,
      last_names: row.apellidos === "" ? null : row.apellidos,
    }),
    { onConflict: "action_id,user_id" },
  );
  if (error) throw new Error(`Inscripción: ${error.message}`);
  return existing == null;
}
