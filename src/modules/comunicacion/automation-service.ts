import "server-only";

import { z } from "zod";

import { writeAudit } from "@/lib/audit";
import { tenantGuard } from "@/lib/tenant-guard";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { AUTOMATION_KINDS, type AutomationKind } from "@/modules/comunicacion/domain/automation";

/**
 * Config de automatización por acción (staff) + opt-out del alumno (task 3.9).
 * La escritura de config va por service-role con audit; el opt-out del alumno se
 * auto-gestiona (RLS propio). NADA de esto envía a n8n — eso lo hace el worker.
 */

const STAFF = ["otec_admin", "coordinator"] as const;

const settingsSchema = z.object({ inactiveDays: z.number().int().min(1).max(60).optional() }).strip();

export interface AutomationConfigItem {
  readonly kind: AutomationKind;
  readonly enabled: boolean;
  readonly settings: { inactiveDays?: number };
}

export async function getAutomationConfig(principal: Principal, actionId: string): Promise<AutomationConfigItem[] | null> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, STAFF)) return null;
  const guard = tenantGuard(principal.tenantId);
  const { data: action } = await guard.db.from("actions").select("id").eq("tenant_id", principal.tenantId).eq("id", actionId).maybeSingle();
  if (!action) return null;
  const { data } = await guard.db.from("automation_config").select("kind, enabled, settings").eq("tenant_id", principal.tenantId).eq("action_id", actionId);
  const byKind = new Map((data ?? []).map((c) => [c.kind as AutomationKind, c]));
  return AUTOMATION_KINDS.map((kind) => {
    const row = byKind.get(kind);
    return { kind, enabled: Boolean(row?.enabled), settings: (row?.settings ?? {}) as { inactiveDays?: number } };
  });
}

export async function setAutomationConfig(
  principal: Principal,
  actionId: string,
  kind: string,
  enabled: boolean,
  settings: unknown,
): Promise<{ ok: boolean }> {
  if (!principal.tenantId || !authorize(principal, principal.tenantId, STAFF)) return { ok: false };
  if (!AUTOMATION_KINDS.includes(kind as AutomationKind)) return { ok: false };
  const parsed = settingsSchema.safeParse(settings ?? {});
  if (!parsed.success) return { ok: false };
  const guard = tenantGuard(principal.tenantId);
  const { data: action } = await guard.db.from("actions").select("id").eq("tenant_id", principal.tenantId).eq("id", actionId).maybeSingle();
  if (!action) return { ok: false };
  const { error } = await guard.db.from("automation_config").upsert(
    guard.withTenant({ action_id: actionId, kind, enabled, settings: parsed.data, updated_by: principal.userId }),
    { onConflict: "action_id,kind" },
  );
  if (error) return { ok: false };
  await writeAudit(guard, { actorUserId: principal.userId, action: "automation.configured", entity: "automation_config", entityId: actionId, details: { kind, enabled } });
  return { ok: true };
}

// ---------- Opt-out del alumno (auto-servicio) ----------
export type OptOutChannel = "email" | "whatsapp";
const CHANNELS: OptOutChannel[] = ["email", "whatsapp"];

export async function getMyOptOuts(principal: Principal): Promise<OptOutChannel[]> {
  if (!principal.tenantId) return [];
  const guard = tenantGuard(principal.tenantId);
  const { data } = await guard.db.from("communication_opt_outs").select("channel").eq("tenant_id", principal.tenantId).eq("user_id", principal.userId);
  return (data ?? []).map((o) => o.channel as OptOutChannel);
}

export async function setMyOptOut(principal: Principal, channel: string, optedOut: boolean): Promise<{ ok: boolean }> {
  if (!principal.tenantId || !CHANNELS.includes(channel as OptOutChannel)) return { ok: false };
  const guard = tenantGuard(principal.tenantId);
  if (optedOut) {
    const { error } = await guard.db.from("communication_opt_outs").upsert(
      guard.withTenant({ user_id: principal.userId, channel }),
      { onConflict: "tenant_id,user_id,channel", ignoreDuplicates: true },
    );
    if (error) return { ok: false };
    await writeAudit(guard, { actorUserId: principal.userId, action: "communication.opt_out", entity: "communication_opt_outs", entityId: principal.userId, details: { channel } });
  } else {
    const { error } = await guard.db.from("communication_opt_outs").delete().eq("tenant_id", principal.tenantId).eq("user_id", principal.userId).eq("channel", channel);
    if (error) return { ok: false };
    await writeAudit(guard, { actorUserId: principal.userId, action: "communication.opt_in", entity: "communication_opt_outs", entityId: principal.userId, details: { channel } });
  }
  return { ok: true };
}
