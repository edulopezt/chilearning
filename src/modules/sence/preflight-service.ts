import "server-only";

import { senceEnv } from "@/lib/env.server";
import type { TenantGuard } from "@/lib/tenant-guard";
import {
  evaluateActionPreflight,
  type ActionPreflightChecklist,
} from "@/modules/sence/domain/action-preflight";
import { localIsoDate } from "@/modules/sence/domain/day1";
import { MAX_LENGTH } from "@/modules/sence/domain/preflight";
import { decryptToken, parseEncryptionKey } from "@/modules/sence/domain/token-crypto";

/**
 * Pre-flight de acción (task 2.7, HU-5.8): arma el input del checklist puro
 * leyendo acción/curso/config/inscritos del tenant y lo evalúa. Como el motor
 * (I-16: este módulo NO importa de otros módulos), la AUTORIZACIÓN es de la
 * capa app: recibe un `TenantGuard` ya construido para un actor autorizado.
 *
 * El token se descifra UNA vez solo para derivar `tokenOk` (¿sigue descifrable
 * tras una rotación de clave? ¿largo normativo?) y se descarta: jamás sale de
 * esta función ni entra al dominio (I-6/I-7).
 *
 * El estado de la guía Clave Única se lee de `audit_log` (la escribe el
 * servicio de comunicación; aquí solo se consulta la marca).
 */

export interface ActionPreflightView {
  readonly action: {
    readonly id: string;
    readonly codigoAccion: string;
    readonly courseName: string;
    readonly environment: string;
    readonly startsOn: string | null;
    readonly endsOn: string | null;
  };
  readonly checklist: ActionPreflightChecklist;
  readonly totals: { enrolled: number; exempt: number; invalid: number };
  /** Última alerta de día-1 de la acción (si existe). */
  readonly day1Alert: { createdAt: string; message: string } | null;
  readonly guideSentAt: string | null;
}

export async function getActionPreflight(
  guard: TenantGuard,
  actionId: string,
): Promise<{ ok: true; view: ActionPreflightView } | { ok: false; error: "not_found" }> {
  const { data: action } = await guard
    .from("actions")
    .select("id, course_id, codigo_accion, training_line, environment, starts_on, ends_on")
    .eq("id", actionId)
    .maybeSingle();
  if (!action) return { ok: false, error: "not_found" };

  const [{ data: course }, { data: config }, { data: enrollments }, guideSentAt, day1Alert] =
    await Promise.all([
      guard.db
        .from("courses")
        .select("name, cod_sence")
        .eq("id", action.course_id as string)
        .eq("tenant_id", guard.tenantId)
        .maybeSingle(),
      guard.db
        .from("sence_otec_config")
        .select("rut_otec, token_encrypted")
        .eq("tenant_id", guard.tenantId)
        .maybeSingle(),
      guard.db
        .from("enrollments")
        .select("id, run, exento")
        .eq("tenant_id", guard.tenantId)
        .eq("action_id", actionId),
      readGuideSentAt(guard, actionId),
      readDay1Alert(guard, actionId),
    ]);

  // Derivados del token (I-6): descifrar UNA vez, medir, descartar.
  let tokenDerived: { hasToken: boolean; tokenOk: boolean } = {
    hasToken: false,
    tokenOk: false,
  };
  if (config?.token_encrypted) {
    try {
      const key = parseEncryptionKey(senceEnv().tokenEncryptionKey);
      const token = decryptToken(config.token_encrypted as string, key);
      tokenDerived = {
        hasToken: true,
        tokenOk: token.length > 0 && token.length <= MAX_LENGTH.token,
      };
    } catch {
      // Token guardado pero ilegible (p.ej. rotó la clave de cifrado).
      tokenDerived = { hasToken: true, tokenOk: false };
    }
  }

  const enrollmentRows = (enrollments ?? []) as { id: string; run: string; exento: boolean }[];

  const checklist = evaluateActionPreflight({
    action: {
      codigoAccion: action.codigo_accion as string,
      trainingLine: action.training_line as number,
      environment: action.environment as string,
      startsOn: (action.starts_on as string | null) ?? null,
      endsOn: (action.ends_on as string | null) ?? null,
    },
    course: { codSence: (course?.cod_sence as string | null) ?? null },
    config: config
      ? { rutOtec: (config.rut_otec as string) ?? "", ...tokenDerived }
      : null,
    enrollments: enrollmentRows.map((e) => ({
      enrollmentId: e.id,
      run: e.run,
      exento: e.exento,
    })),
    todayIsoDate: localIsoDate(Date.now(), "America/Santiago"),
    guideSentAt,
  });

  return {
    ok: true,
    view: {
      action: {
        id: action.id as string,
        codigoAccion: action.codigo_accion as string,
        courseName: (course?.name as string) ?? "",
        environment: action.environment as string,
        startsOn: (action.starts_on as string | null) ?? null,
        endsOn: (action.ends_on as string | null) ?? null,
      },
      checklist,
      totals: {
        enrolled: enrollmentRows.length,
        exempt: enrollmentRows.filter((e) => e.exento).length,
        invalid: checklist.invalidRuns.length,
      },
      day1Alert,
      guideSentAt,
    },
  };
}

/** Última marca de guía enviada (real o manual) desde la bitácora. */
async function readGuideSentAt(guard: TenantGuard, actionId: string): Promise<string | null> {
  const { data } = await guard.db
    .from("audit_log")
    .select("created_at")
    .eq("tenant_id", guard.tenantId)
    .in("action", ["sence.guide_sent", "sence.guide_marked_sent"])
    .eq("entity", "actions")
    .eq("entity_id", actionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.created_at as string | undefined) ?? null;
}

/** Última alerta de asistencia baja del día 1 para la acción. */
async function readDay1Alert(
  guard: TenantGuard,
  actionId: string,
): Promise<{ createdAt: string; message: string } | null> {
  const { data } = await guard.db
    .from("alerts")
    .select("created_at, message")
    .eq("tenant_id", guard.tenantId)
    .eq("kind", "sence_day1_low_attendance")
    .eq("action_id", actionId)
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  if (!data) return null;
  return { createdAt: data.created_at as string, message: data.message as string };
}
