import "server-only";

import { writeAudit } from "@/lib/audit";
import { tenantGuard } from "@/lib/tenant-guard";
import { listCourses } from "@/modules/academico/course-service";
import { hasRole, type Principal } from "@/modules/core/domain/rbac";

/**
 * Panel admin del Tutor IA (task 5.8b, HU-11.2): habilitar por curso, límite
 * diario, presupuesto/costo del tenant y temas frecuentes. Gate:
 * otec_admin/coordinator (mismo criterio que `course-service.ts`).
 */

function canManage(principal: Principal): boolean {
  return Boolean(principal.tenantId) && (hasRole(principal, "otec_admin") || hasRole(principal, "coordinator"));
}

export interface CourseTutorConfigRow {
  readonly courseId: string;
  readonly courseName: string;
  readonly enabled: boolean;
  readonly dailyMessageLimit: number | null;
}

/** Todos los cursos del tenant con su config del Tutor IA (o los defaults si no existe fila). */
export async function listCourseTutorConfigs(principal: Principal): Promise<CourseTutorConfigRow[]> {
  if (!canManage(principal)) return [];
  const tenantId = principal.tenantId!;
  const guard = tenantGuard(tenantId);

  const [courses, { data: configs }] = await Promise.all([
    listCourses(principal),
    guard.db.from("tutor_course_config").select("course_id, enabled, daily_message_limit").eq("tenant_id", tenantId),
  ]);

  const byCourseId = new Map((configs ?? []).map((c) => [c.course_id as string, c]));
  return courses.map((c) => {
    const cfg = byCourseId.get(c.id);
    return {
      courseId: c.id,
      courseName: c.name,
      enabled: Boolean(cfg?.enabled),
      dailyMessageLimit: (cfg?.daily_message_limit as number | null | undefined) ?? null,
    };
  });
}

export async function setCourseTutorConfig(
  principal: Principal,
  courseId: string,
  input: { readonly enabled: boolean; readonly dailyMessageLimit: number | null },
): Promise<{ readonly ok: boolean }> {
  if (!canManage(principal)) return { ok: false };
  const tenantId = principal.tenantId!;
  const guard = tenantGuard(tenantId);

  const { error } = await guard.db
    .from("tutor_course_config")
    .upsert(
      guard.withTenant({
        course_id: courseId,
        enabled: input.enabled,
        daily_message_limit: input.dailyMessageLimit,
        updated_by: principal.userId,
      }),
      { onConflict: "tenant_id,course_id" },
    );
  if (error) {
    console.error("[tutor-ia] fallo guardando tutor_course_config", { message: error.message });
    return { ok: false };
  }

  await writeAudit(guard, {
    actorUserId: principal.userId,
    action: "tutor.course_config.updated",
    entity: "tutor_course_config",
    entityId: courseId,
    details: { enabled: input.enabled, dailyMessageLimit: input.dailyMessageLimit },
  });
  return { ok: true };
}

export interface TenantUsageSummary {
  readonly monthlyBudget: number;
  readonly tokensThisMonth: number;
  readonly costUsdThisMonth: number;
}

/** Mismo cálculo que `checkBudgetForContext` (tutor-chat-service.ts), sumando también el costo real. */
export async function getTenantUsageSummary(principal: Principal): Promise<TenantUsageSummary | null> {
  if (!canManage(principal)) return null;
  const tenantId = principal.tenantId!;
  const guard = tenantGuard(tenantId);

  const today = new Date().toISOString().slice(0, 10);
  const firstOfMonth = `${today.slice(0, 7)}-01`;

  const [{ data: rows }, { data: budgetRow }] = await Promise.all([
    guard.db
      .from("tutor_usage_daily")
      .select("input_tokens, output_tokens, cost_usd")
      .eq("tenant_id", tenantId)
      .gte("day", firstOfMonth),
    guard.db.from("tutor_tenant_budget").select("monthly_token_budget").eq("tenant_id", tenantId).maybeSingle(),
  ]);

  let tokensThisMonth = 0;
  let costUsdThisMonth = 0;
  for (const r of rows ?? []) {
    tokensThisMonth += Number(r.input_tokens ?? 0) + Number(r.output_tokens ?? 0);
    costUsdThisMonth += Number(r.cost_usd ?? 0);
  }

  const monthlyBudget =
    (budgetRow?.monthly_token_budget as number | null | undefined) ??
    Number(process.env.AI_MONTHLY_TOKEN_BUDGET_DEFAULT ?? 1_000_000);

  return { monthlyBudget, tokensThisMonth, costUsdThisMonth };
}

export interface FrequentTopicRow {
  readonly lessonId: string;
  readonly lessonTitle: string;
  readonly citedCount: number;
}

/** Temas más citados por el tutor en los últimos 30 días (tallea `citations` jsonb en JS). */
export async function getFrequentTopics(principal: Principal, limit = 10): Promise<FrequentTopicRow[]> {
  if (!canManage(principal)) return [];
  const tenantId = principal.tenantId!;
  const guard = tenantGuard(tenantId);

  const thirtyDaysAgoIso = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();
  const { data: rows } = await guard.db
    .from("tutor_messages")
    .select("citations")
    .eq("tenant_id", tenantId)
    .eq("role", "assistant")
    .gte("created_at", thirtyDaysAgoIso);

  const counts = new Map<string, { lessonTitle: string; count: number }>();
  for (const row of rows ?? []) {
    const citations = (row.citations ?? []) as { lessonId?: string; lessonTitle?: string }[];
    for (const c of citations) {
      if (!c.lessonId) continue;
      const existing = counts.get(c.lessonId);
      if (existing) existing.count += 1;
      else counts.set(c.lessonId, { lessonTitle: c.lessonTitle ?? "", count: 1 });
    }
  }

  return [...counts.entries()]
    .map(([lessonId, v]) => ({ lessonId, lessonTitle: v.lessonTitle, citedCount: v.count }))
    .sort((a, b) => b.citedCount - a.citedCount)
    .slice(0, limit);
}
