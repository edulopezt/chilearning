import "server-only";

import { randomBytes, randomUUID } from "node:crypto";

import { getPublicEnv } from "@/lib/env";
import { tenantGuard, type TenantGuard } from "@/lib/tenant-guard";
import { enrollmentGroupLabel } from "@/modules/academico/domain/enrollment-group";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import {
  attendancePctFromCells,
  type DayCell,
} from "@/modules/certificados/domain/attendance";
import {
  evaluateEligibility,
  PASSING_GRADE,
  type EligibilityReason,
} from "@/modules/certificados/domain/eligibility";
import { computeExpiresAt } from "@/modules/certificados/domain/expiry";
import { buildCertificateSnapshot, type CertificateSnapshot } from "@/modules/certificados/domain/snapshot";
import { getCompliancePanel } from "@/modules/reportes/cumplimiento-service";
import { getGradebook } from "@/modules/evaluacion/gradebook-service";

/**
 * Certificados PDF (task 3.2, HU-7.1/7.2). Orquesta elegibilidad (reusa
 * gradebook + cumplimiento + progreso + encuesta), emisión atómica (RPC
 * `issue_certificate` con folio), render PDF/QR, revocación y verificación
 * PÚBLICA por token (RUN enmascarado, P4). El PDF con RUN completo se guarda en
 * bucket privado y se descarga autenticado.
 */

const ISSUERS = ["otec_admin", "coordinator"] as const;
const VIEWERS_STAFF = ["otec_admin", "coordinator", "instructor", "supervisor"] as const;
const PAGE = 1000;

async function fetchAll<T>(page: (offset: number) => PromiseLike<{ data: T[] | null }>): Promise<T[]> {
  const out: T[] = [];
  for (let offset = 0; ; offset += PAGE) {
    const { data } = await page(offset);
    const rows = data ?? [];
    out.push(...rows);
    if (rows.length < PAGE) break;
  }
  return out;
}

function studentName(first: string | null, last: string | null): string {
  return [first ?? "", last ?? ""].join(" ").trim() || "—";
}

function parseMinGrade(rules: unknown): number {
  const raw = (rules as { minGrade?: unknown } | null)?.minGrade;
  return typeof raw === "number" && raw >= 1 && raw <= 7 ? raw : PASSING_GRADE;
}

interface CompletionRules {
  requireAllLessons: boolean;
  requireSurvey: boolean;
  minAttendancePct: number;
  minGrade: number;
}

function parseCompletionRules(raw: unknown): CompletionRules {
  const o = (typeof raw === "object" && raw !== null ? raw : {}) as Record<string, unknown>;
  return {
    requireAllLessons: o.requireAllLessons !== false,
    requireSurvey: o.requireSurvey === true,
    minAttendancePct: typeof o.minAttendancePct === "number" ? o.minAttendancePct : 0,
    minGrade: parseMinGrade(raw),
  };
}

export interface EligibilityRow {
  readonly enrollmentId: string;
  readonly name: string;
  readonly run: string;
  readonly exento: boolean;
  readonly eligible: boolean;
  readonly reasons: readonly EligibilityReason[];
  readonly attendancePct: number;
  readonly finalGrade: number | null;
  readonly certificate: { id: string; folio: string; status: string } | null;
}

export interface ActionEligibility {
  readonly actionId: string;
  readonly courseName: string;
  readonly code: string;
  readonly isSence: boolean;
  readonly minAttendancePct: number;
  readonly rows: readonly EligibilityRow[];
  /** Etiqueta del grupo SENCE del curso (`Sence-<código>`) o null (HU-2.2). */
  readonly senceGroupLabel: string | null;
}

interface ActionContext {
  tenantId: string;
  guard: TenantGuard;
  actionId: string;
  courseId: string;
  code: string;
  courseName: string;
  hours: number;
  codSence: string | null;
  isSence: boolean;
  startsOn: string | null;
  endsOn: string | null;
  rules: CompletionRules;
  effectiveThreshold: number;
  /** Vigencia del certificado en meses; null = no vence (task 5.12, HU-7.3). */
  validityMonths: number | null;
}

async function loadActionContext(guard: TenantGuard, tenantId: string, actionId: string): Promise<ActionContext | null> {
  const { data: action } = await guard.db
    .from("actions")
    .select("id, course_id, codigo_accion, starts_on, ends_on, min_attendance_pct_override, courses!inner(name, hours, sence, cod_sence, completion_rules, validity_months)")
    .eq("tenant_id", tenantId)
    .eq("id", actionId)
    .maybeSingle();
  if (!action) return null;
  const course = (action as unknown as {
    courses: {
      name: string; hours: number; sence: boolean; cod_sence: string | null;
      completion_rules: unknown; validity_months: number | null;
    };
  }).courses;
  const rules = parseCompletionRules(course.completion_rules);
  const override = action.min_attendance_pct_override as number | null;
  const effectiveThreshold = override ?? rules.minAttendancePct;
  return {
    tenantId,
    guard,
    actionId,
    courseId: action.course_id as string,
    code: action.codigo_accion as string,
    courseName: course.name,
    hours: course.hours,
    codSence: course.cod_sence,
    isSence: course.sence,
    startsOn: (action.starts_on as string | null) ?? null,
    endsOn: (action.ends_on as string | null) ?? null,
    rules,
    effectiveThreshold,
    validityMonths: course.validity_months ?? null,
  };
}

/** Mapa inscripción → % de asistencia y exento (reusa el panel de cumplimiento). */
async function attendanceByEnrollment(
  principal: Principal,
  actionId: string,
): Promise<Map<string, { pct: number; exento: boolean }>> {
  const panel = await getCompliancePanel(principal, actionId);
  const map = new Map<string, { pct: number; exento: boolean }>();
  if (!panel) return map;
  for (const row of panel.rows) {
    map.set(row.enrollmentId, {
      pct: attendancePctFromCells(row.cells as readonly DayCell[]),
      exento: row.exento,
    });
  }
  return map;
}

/** Inscripción → set de lecciones publicadas completadas (para requireAllLessons). */
async function lessonsDoneByEnrollment(
  guard: TenantGuard,
  tenantId: string,
  courseId: string,
  enrollmentIds: string[],
): Promise<{ publishedLessonIds: string[]; completed: Map<string, Set<string>> }> {
  const lessons = await fetchAll<{ id: string }>((offset) =>
    guard.db.from("lessons").select("id").eq("tenant_id", tenantId).eq("course_id", courseId).eq("status", "published").order("id").range(offset, offset + PAGE - 1),
  );
  const publishedLessonIds = lessons.map((l) => l.id);
  const completed = new Map<string, Set<string>>();
  if (enrollmentIds.length === 0 || publishedLessonIds.length === 0) return { publishedLessonIds, completed };
  const progress = await fetchAll<{ enrollment_id: string; lesson_id: string }>((offset) =>
    guard.db
      .from("lesson_progress")
      .select("enrollment_id, lesson_id")
      .eq("tenant_id", tenantId)
      .eq("completed", true)
      .in("enrollment_id", enrollmentIds)
      .order("enrollment_id")
      .range(offset, offset + PAGE - 1),
  );
  for (const p of progress) {
    const set = completed.get(p.enrollment_id) ?? new Set<string>();
    set.add(p.lesson_id);
    completed.set(p.enrollment_id, set);
  }
  return { publishedLessonIds, completed };
}

/** Set de inscripciones que respondieron alguna encuesta publicada del curso. */
async function surveyDoneByEnrollment(
  guard: TenantGuard,
  tenantId: string,
  courseId: string,
  enrollmentIds: string[],
): Promise<{ hasPublishedSurvey: boolean; done: Set<string> }> {
  const surveys = await fetchAll<{ id: string }>((offset) =>
    guard.db.from("surveys").select("id").eq("tenant_id", tenantId).eq("course_id", courseId).eq("status", "published").order("id").range(offset, offset + PAGE - 1),
  );
  const done = new Set<string>();
  if (surveys.length === 0 || enrollmentIds.length === 0) return { hasPublishedSurvey: surveys.length > 0, done };
  const subs = await fetchAll<{ enrollment_id: string }>((offset) =>
    guard.db
      .from("survey_submissions")
      .select("enrollment_id")
      .eq("tenant_id", tenantId)
      .in("survey_id", surveys.map((s) => s.id))
      .in("enrollment_id", enrollmentIds)
      .order("enrollment_id")
      .range(offset, offset + PAGE - 1),
  );
  for (const s of subs) done.add(s.enrollment_id);
  return { hasPublishedSurvey: true, done };
}

export async function getActionEligibility(
  principal: Principal,
  actionId: string,
): Promise<ActionEligibility | null> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ISSUERS)) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const ctx = await loadActionContext(guard, tenantId, actionId);
  if (!ctx) return null;

  const enrollments = await fetchAll<{ id: string; run: string; exento: boolean; first_names: string | null; last_names: string | null }>((offset) =>
    guard.db.from("enrollments").select("id, run, exento, first_names, last_names").eq("tenant_id", tenantId).eq("action_id", actionId).order("last_names", { nullsFirst: false }).order("id").range(offset, offset + PAGE - 1),
  );
  const enrollmentIds = enrollments.map((e) => e.id);

  const [attendance, lessonsInfo, surveyInfo, gradebook, certs] = await Promise.all([
    attendanceByEnrollment(principal, actionId),
    lessonsDoneByEnrollment(guard, tenantId, ctx.courseId, enrollmentIds),
    surveyDoneByEnrollment(guard, tenantId, ctx.courseId, enrollmentIds),
    getGradebook(principal, actionId),
    fetchAll<{ id: string; enrollment_id: string; folio: string; status: string }>((offset) =>
      guard.db.from("certificates").select("id, enrollment_id, folio, status").eq("tenant_id", tenantId).eq("action_id", actionId).order("id").range(offset, offset + PAGE - 1),
    ),
  ]);

  const gradeByEnrollment = new Map<string, number | null>();
  for (const r of gradebook?.gradebook.rows ?? []) gradeByEnrollment.set(r.enrollmentId, r.finalGrade);
  // Un solo certificado vigente por inscripción; conserva el emitido si existe.
  const certByEnrollment = new Map<string, { id: string; folio: string; status: string }>();
  for (const c of certs) {
    const cur = certByEnrollment.get(c.enrollment_id);
    if (!cur || c.status === "issued") certByEnrollment.set(c.enrollment_id, { id: c.id, folio: c.folio, status: c.status });
  }

  const rows: EligibilityRow[] = enrollments.map((e) => {
    const att = attendance.get(e.id) ?? { pct: 0, exento: e.exento };
    const done = lessonsInfo.completed.get(e.id) ?? new Set<string>();
    const allLessonsDone = lessonsInfo.publishedLessonIds.every((id) => done.has(id));
    const surveyDone = ctx.rules.requireSurvey ? surveyInfo.hasPublishedSurvey && surveyInfo.done.has(e.id) : true;
    const finalGrade = gradeByEnrollment.get(e.id) ?? null;
    const result = evaluateEligibility(
      { requireAllLessons: ctx.rules.requireAllLessons, requireSurvey: ctx.rules.requireSurvey, minGrade: ctx.rules.minGrade, minAttendancePct: ctx.effectiveThreshold, isSence: ctx.isSence },
      { allLessonsDone, finalGrade, surveyDone, attendancePct: att.pct, exento: att.exento },
    );
    return {
      enrollmentId: e.id,
      name: studentName(e.first_names, e.last_names),
      run: e.run,
      exento: att.exento,
      eligible: result.eligible,
      reasons: result.reasons,
      attendancePct: att.pct,
      finalGrade,
      certificate: certByEnrollment.get(e.id) ?? null,
    };
  });

  return {
    actionId,
    courseName: ctx.courseName,
    code: ctx.code,
    isSence: ctx.isSence,
    minAttendancePct: ctx.effectiveThreshold,
    rows,
    senceGroupLabel: enrollmentGroupLabel(false, ctx.codSence),
  };
}

// ---------- emisión ----------

export type IssueResult =
  | { readonly ok: true; readonly certificateId: string; readonly folio: string }
  | { readonly ok: false; readonly error: "forbidden" | "not_found" | "not_eligible" | "already_issued" | "failed" };

async function tenantVerifyBase(guard: TenantGuard, tenantId: string): Promise<string> {
  const { data } = await guard.db.from("tenants").select("slug").eq("id", tenantId).maybeSingle();
  const slug = (data?.slug as string) ?? "app";
  const root = getPublicEnv().tenantRootDomain;
  return `https://${slug}.${root}`;
}

export async function issueCertificate(principal: Principal, enrollmentId: string): Promise<IssueResult> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ISSUERS)) return { ok: false, error: "forbidden" };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);

  const { data: enr } = await guard.db
    .from("enrollments")
    .select("id, action_id, run, first_names, last_names")
    .eq("tenant_id", tenantId)
    .eq("id", enrollmentId)
    .maybeSingle();
  if (!enr) return { ok: false, error: "not_found" };
  const actionId = enr.action_id as string;

  const eligibility = await getActionEligibility(principal, actionId);
  if (!eligibility) return { ok: false, error: "not_found" };
  const row = eligibility.rows.find((r) => r.enrollmentId === enrollmentId);
  if (!row) return { ok: false, error: "not_found" };
  if (row.certificate && row.certificate.status === "issued") return { ok: false, error: "already_issued" };
  if (!row.eligible) return { ok: false, error: "not_eligible" };

  const ctx = await loadActionContext(guard, tenantId, actionId);
  if (!ctx) return { ok: false, error: "not_found" };
  const { data: tenant } = await guard.db.from("tenants").select("name, rut, branding").eq("id", tenantId).maybeSingle();
  const branding = (tenant?.branding ?? {}) as { primaryColor?: string; accentColor?: string; logoUrl?: string };

  // UN solo instante de emisión para el snapshot y para la vigencia: si cada uno
  // llamara a `new Date()`, el vencimiento podría quedar milisegundos corrido
  // respecto del `issuedAt` que muestra el PDF.
  const issuedAtISO = new Date().toISOString();
  const snapshot: CertificateSnapshot = buildCertificateSnapshot({
    studentName: studentName(enr.first_names as string | null, enr.last_names as string | null),
    run: enr.run as string,
    courseName: ctx.courseName,
    hours: ctx.hours,
    startsOn: ctx.startsOn,
    endsOn: ctx.endsOn,
    finalGrade: row.finalGrade,
    codSence: ctx.codSence,
    actionCode: ctx.code,
    attendancePct: row.attendancePct,
    otecName: (tenant?.name as string) ?? "",
    otecRut: (tenant?.rut as string) ?? null,
    brandPrimary: branding.primaryColor ?? "#1e3a8a",
    brandAccent: branding.accentColor ?? "#0ea5e9",
    logoUrl: branding.logoUrl ?? null,
    isSence: ctx.isSence,
    issuedAtISO,
  });

  const certId = randomUUID();
  const token = randomBytes(16).toString("hex");
  const pdfPath = `${tenantId}/${certId}.pdf`;
  // Vigencia (task 5.12, HU-7.3): va como COLUMNA, no dentro del snapshot — el
  // snapshot es el documento legal congelado (D-112) y esto es metadato
  // operativo para las alertas de recertificación. Curso sin `validity_months`
  // ⇒ null = no vence (el default).
  const expiresAt = computeExpiresAt(issuedAtISO, ctx.validityMonths);

  const { data: folio, error } = await guard.db.rpc("issue_certificate", {
    p_id: certId,
    p_tenant_id: tenantId,
    p_enrollment_id: enrollmentId,
    p_action_id: actionId,
    p_course_id: ctx.courseId,
    p_is_sence: ctx.isSence,
    p_token: token,
    p_snapshot: snapshot,
    p_pdf_path: pdfPath,
    p_actor: principal.userId,
    p_expires_at: expiresAt,
  });
  if (error) {
    if (error.code === "23505") return { ok: false, error: "already_issued" };
    return { ok: false, error: "failed" };
  }

  // Render PDF + QR y subida (best-effort: si falla, el certificado sigue válido
  // y el PDF se regenera on-demand desde el snapshot — D-117).
  await renderAndUpload(guard, tenantId, certId, folio as string, token, snapshot).catch(() => undefined);

  return { ok: true, certificateId: certId, folio: folio as string };
}

async function renderAndUpload(
  guard: TenantGuard,
  tenantId: string,
  certId: string,
  folio: string,
  token: string,
  snapshot: CertificateSnapshot,
): Promise<void> {
  const { renderCertificatePdf } = await import("@/modules/certificados/domain/pdf");
  const QRCode = (await import("qrcode")).default;
  const verifyUrl = `${await tenantVerifyBase(guard, tenantId)}/verificar/${token}`;
  const qrPng = await QRCode.toBuffer(verifyUrl, { errorCorrectionLevel: "M", margin: 1, width: 240 });
  const pdf = await renderCertificatePdf(snapshot, {
    folio,
    qrPng: new Uint8Array(qrPng),
    verifyUrl,
    labels: CERT_PDF_LABELS,
  });
  await guard.db.storage.from("certificates").upload(`${tenantId}/${certId}.pdf`, pdf, {
    contentType: "application/pdf",
    upsert: true,
  });
}

/** Etiquetas es-CL del PDF (no viven en el dominio puro). */
const CERT_PDF_LABELS = {
  title: "CERTIFICADO",
  grantedTo: "Se otorga el presente certificado a",
  run: "RUN",
  completedCourse: "por haber completado satisfactoriamente el curso",
  hours: "Horas",
  period: "Período",
  finalGrade: "Nota final",
  attendance: "Asistencia SENCE",
  senceCode: "Código SENCE",
  actionCode: "Código de acción",
  folio: "Folio",
  verifyAt: "Verifica la autenticidad en:",
  legalRep: "Representante Legal",
  senceNote:
    "Certificado emitido por la OTEC. No reemplaza la Declaración Jurada de asistencia oficial de SENCE (lce.sence.cl/certificadoasistencia).",
} as const;

export async function issueBatch(
  principal: Principal,
  actionId: string,
): Promise<{ issued: number; skipped: number }> {
  const eligibility = await getActionEligibility(principal, actionId);
  if (!eligibility) return { issued: 0, skipped: 0 };
  let issued = 0;
  let skipped = 0;
  // Síncrono acotado (v1); cola BullMQ = follow-up. Emite solo elegibles sin cert.
  for (const row of eligibility.rows) {
    if (!row.eligible || (row.certificate && row.certificate.status === "issued")) {
      skipped += 1;
      continue;
    }
    const res = await issueCertificate(principal, row.enrollmentId);
    if (res.ok) issued += 1;
    else skipped += 1;
  }
  return { issued, skipped };
}

export async function revokeCertificate(
  principal: Principal,
  certificateId: string,
  reason: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ISSUERS)) return { ok: false, error: "forbidden" };
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const clean = reason.trim();
  if (clean.length === 0) return { ok: false, error: "reason_required" };
  const { error } = await guard.db.rpc("revoke_certificate", {
    p_id: certificateId,
    p_tenant_id: tenantId,
    p_reason: clean,
    p_actor: principal.userId,
  });
  if (error) return { ok: false, error: "not_found" };
  return { ok: true };
}

// ---------- lecturas ----------

export interface CertificateRow {
  readonly id: string;
  readonly enrollmentId: string;
  readonly folio: string;
  readonly status: string;
  readonly studentName: string;
  readonly issuedAt: string;
}

export async function listActionCertificates(principal: Principal, actionId: string): Promise<CertificateRow[]> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, VIEWERS_STAFF)) return [];
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const rows = await fetchAll<{ id: string; enrollment_id: string; folio: string; status: string; issued_at: string; snapshot: { studentName?: string } }>((offset) =>
    guard.db.from("certificates").select("id, enrollment_id, folio, status, issued_at, snapshot").eq("tenant_id", tenantId).eq("action_id", actionId).order("issued_at", { ascending: false }).order("id").range(offset, offset + PAGE - 1),
  );
  return rows.map((r) => ({
    id: r.id,
    enrollmentId: r.enrollment_id,
    folio: r.folio,
    status: r.status,
    studentName: r.snapshot?.studentName ?? "—",
    issuedAt: r.issued_at,
  }));
}

export interface MyCertificate {
  readonly id: string;
  readonly folio: string;
  readonly status: string;
  readonly courseName: string;
  readonly issuedAt: string;
  /** Vencimiento del certificado (task 5.12, HU-7.3); null = no vence. */
  readonly expiresAt: string | null;
  /** true = ya venció (precalculado en el servidor; la vista es un RSC puro). */
  readonly expired: boolean;
}

export async function getMyCertificates(principal: Principal): Promise<MyCertificate[]> {
  if (!principal.tenantId) return [];
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  // RLS limita a los certificados de las inscripciones del propio alumno.
  const enrollments = await fetchAll<{ id: string }>((offset) =>
    guard.db.from("enrollments").select("id").eq("tenant_id", tenantId).eq("user_id", principal.userId).order("id").range(offset, offset + PAGE - 1),
  );
  if (enrollments.length === 0) return [];
  const rows = await fetchAll<{ id: string; folio: string; status: string; issued_at: string; expires_at: string | null; snapshot: { courseName?: string } }>((offset) =>
    guard.db.from("certificates").select("id, folio, status, issued_at, expires_at, snapshot").eq("tenant_id", tenantId).in("enrollment_id", enrollments.map((e) => e.id)).order("issued_at", { ascending: false }).order("id").range(offset, offset + PAGE - 1),
  );
  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    folio: r.folio,
    status: r.status,
    courseName: r.snapshot?.courseName ?? "—",
    issuedAt: r.issued_at,
    expiresAt: r.expires_at ?? null,
    expired: r.expires_at ? new Date(r.expires_at).getTime() < now : false,
  }));
}

/** URL firmada de descarga del PDF (dueño o staff). Regenera si falta el objeto. */
export async function getCertificateDownloadUrl(principal: Principal, certificateId: string): Promise<string | null> {
  if (!principal.tenantId) return null;
  const tenantId = principal.tenantId;
  const guard = tenantGuard(tenantId);
  const { data: cert } = await guard.db.from("certificates").select("id, enrollment_id, status, pdf_path, folio, verification_token, snapshot").eq("tenant_id", tenantId).eq("id", certificateId).maybeSingle();
  if (!cert) return null;
  // Un certificado revocado es un documento nulo y el PDF no lleva marca de
  // revocación → no se sirve (4-ojos MEDIUM-2). Su estado se ve en /verificar.
  if (cert.status !== "issued") return null;
  // El PDF trae el RUN completo. `guard.db` es service-role (bypassa RLS), así que
  // la autorización se comprueba EXPLÍCITAMENTE aquí: staff del tenant O el alumno
  // dueño de la inscripción. Sin esto un alumno podría bajar el cert de otro.
  const isStaff = authorize(principal, tenantId, VIEWERS_STAFF);
  if (!isStaff) {
    const { data: owned } = await guard.db
      .from("enrollments")
      .select("id")
      .eq("tenant_id", tenantId)
      .eq("id", cert.enrollment_id)
      .eq("user_id", principal.userId)
      .maybeSingle();
    if (!owned) return null;
  }
  const path = (cert.pdf_path as string | null) ?? `${tenantId}/${certificateId}.pdf`;

  let signed = await guard.db.storage.from("certificates").createSignedUrl(path, 3600);
  if (signed.error || !signed.data) {
    // Regenera on-demand desde el snapshot (determinismo D-112).
    await renderAndUpload(guard, tenantId, certificateId, cert.folio as string, cert.verification_token as string, cert.snapshot as CertificateSnapshot).catch(() => undefined);
    signed = await guard.db.storage.from("certificates").createSignedUrl(path, 3600);
  }
  return signed.data?.signedUrl ?? null;
}

// ---------- verificación pública ----------

export interface PublicVerification {
  readonly folio: string;
  readonly status: string;
  readonly revokedReason: string | null;
  readonly studentName: string;
  readonly runMasked: string;
  readonly courseName: string;
  readonly hours: number | null;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly otecName: string;
  readonly issuedAt: string;
}

/** Verificación pública por token (anon). Nunca expone el RUN completo (P4). */
export async function verifyCertificate(token: string): Promise<PublicVerification | null> {
  const { createClient } = await import("@supabase/supabase-js");
  const env = getPublicEnv();
  const anon = createClient(env.supabaseUrl, env.supabaseAnonKey, { auth: { persistSession: false } });
  const { data, error } = await anon.rpc("verify_certificate", { p_token: token });
  if (error || !data || (Array.isArray(data) && data.length === 0)) return null;
  const row = (Array.isArray(data) ? data[0] : data) as {
    folio: string; status: string; revoked_reason: string | null; student_name: string; run_masked: string;
    course_name: string; hours: number | null; starts_on: string | null; ends_on: string | null; otec_name: string; issued_at: string;
  };
  return {
    folio: row.folio,
    status: row.status,
    revokedReason: row.revoked_reason,
    studentName: row.student_name,
    runMasked: row.run_masked,
    courseName: row.course_name,
    hours: row.hours,
    startsOn: row.starts_on,
    endsOn: row.ends_on,
    otecName: row.otec_name,
    issuedAt: row.issued_at,
  };
}
