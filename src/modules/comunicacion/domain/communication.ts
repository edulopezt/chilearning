/**
 * Dominio puro de comunicación (task 3.4, M9): validadores de anuncios/foro/
 * mensajería/calendario, cálculo de "tiempo de respuesta" visible (SLA) y la
 * fusión del calendario manual con los plazos de instrumentos. Sin IO.
 */

export interface FieldError {
  readonly field: string;
  readonly message: string;
}
export type ParseResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly errors: FieldError[] };

function text(raw: unknown, min: number, max: number, field: string, errors: FieldError[]): string {
  const v = String(raw ?? "").trim();
  if (v.length < min || v.length > max) errors.push({ field, message: `Debe tener entre ${min} y ${max} caracteres.` });
  return v;
}

// ---------- anuncios ----------
export interface AnnouncementInput {
  readonly title: string;
  readonly body: string;
  readonly courseId: string | null;
  readonly actionId: string | null;
}
export function parseAnnouncementInput(raw: { title?: unknown; body?: unknown; courseId?: unknown; actionId?: unknown }): ParseResult<AnnouncementInput> {
  const errors: FieldError[] = [];
  const title = text(raw.title, 1, 200, "title", errors);
  const body = text(raw.body, 1, 20000, "body", errors);
  const courseId = raw.courseId ? String(raw.courseId) : null;
  const actionId = raw.actionId ? String(raw.actionId) : null;
  if (!courseId && !actionId) errors.push({ field: "target", message: "Elige un curso o una acción de destino." });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { title, body, courseId, actionId } };
}

// ---------- foro ----------
export function parseThreadInput(raw: { title?: unknown }): ParseResult<{ title: string }> {
  const errors: FieldError[] = [];
  const title = text(raw.title, 1, 200, "title", errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { title } };
}
export function parsePostInput(raw: { body?: unknown }): ParseResult<{ body: string }> {
  const errors: FieldError[] = [];
  const body = text(raw.body, 1, 20000, "body", errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { body } };
}

// ---------- mensajería ----------
export function parseMessageInput(raw: { subject?: unknown; body?: unknown }): ParseResult<{ subject: string; body: string }> {
  const errors: FieldError[] = [];
  const subject = text(raw.subject, 1, 200, "subject", errors);
  const body = text(raw.body, 1, 20000, "body", errors);
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: { subject, body } };
}

// ---------- calendario ----------
export const CALENDAR_KINDS = ["hito", "evaluacion", "plazo", "sesion", "otro"] as const;
export type CalendarKind = (typeof CALENDAR_KINDS)[number];
export interface CalendarItemInput {
  readonly kind: CalendarKind;
  readonly title: string;
  readonly description: string;
  readonly dueAtISO: string;
}
export function parseCalendarItemInput(raw: { kind?: unknown; title?: unknown; description?: unknown; dueAt?: unknown }): ParseResult<CalendarItemInput> {
  const errors: FieldError[] = [];
  const kind = String(raw.kind ?? "hito") as CalendarKind;
  if (!CALENDAR_KINDS.includes(kind)) errors.push({ field: "kind", message: "Tipo inválido." });
  const title = text(raw.title, 1, 200, "title", errors);
  const description = String(raw.description ?? "").trim();
  if (description.length > 4000) errors.push({ field: "description", message: "Descripción demasiado larga." });
  const dueRaw = String(raw.dueAt ?? "").trim();
  const dueMs = Date.parse(dueRaw);
  if (!dueRaw || Number.isNaN(dueMs)) errors.push({ field: "dueAt", message: "Fecha inválida." });
  if (errors.length > 0) return { ok: false, errors };
  return { ok: true, value: { kind, title, description, dueAtISO: new Date(dueMs).toISOString() } };
}

// ---------- tiempo de respuesta visible (SLA) ----------
export type Sla = "answered" | "green" | "amber" | "red";
export const SLA_THRESHOLDS_HOURS = { amber: 24, red: 72 } as const;

/**
 * Dado el hilo (posts/mensajes con marca de tiempo y origen), calcula desde
 * cuándo hay una consulta del alumno sin responder por el staff, y su semáforo.
 */
export function responseAge(events: readonly { atMs: number; fromStaff: boolean }[], nowMs: number): { pendingSinceMs: number | null; sla: Sla } {
  if (events.length === 0) return { pendingSinceMs: null, sla: "answered" };
  const lastStaffAt = events.filter((e) => e.fromStaff).reduce((m, e) => Math.max(m, e.atMs), -1);
  const pending = events.filter((e) => !e.fromStaff && e.atMs > lastStaffAt).sort((a, b) => a.atMs - b.atMs);
  if (pending.length === 0) return { pendingSinceMs: null, sla: "answered" };
  const since = pending[0]!.atMs;
  const hours = (nowMs - since) / 3_600_000;
  const sla: Sla = hours >= SLA_THRESHOLDS_HOURS.red ? "red" : hours >= SLA_THRESHOLDS_HOURS.amber ? "amber" : "green";
  return { pendingSinceMs: since, sla };
}

// ---------- fusión del calendario ----------
export interface CalendarEntry {
  readonly kind: string;
  readonly title: string;
  readonly dueAtMs: number;
  readonly source: "manual" | "instrument";
}
/** Une los ítems manuales con los plazos de instrumentos (proyección, ordenada). */
export function mergeCalendar(
  manual: readonly { kind: string; title: string; dueAtMs: number }[],
  instruments: readonly { kind: string; title: string; dueAtMs: number }[],
): CalendarEntry[] {
  return [
    ...manual.map((m) => ({ ...m, source: "manual" as const })),
    ...instruments.map((i) => ({ ...i, source: "instrument" as const })),
  ].sort((a, b) => a.dueAtMs - b.dueAtMs);
}
