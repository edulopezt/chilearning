import "server-only";

import { createClient, type SupabaseClient } from "@supabase/supabase-js";

import { serverEnv } from "@/lib/env.server";

/**
 * tenantGuard() — ÚNICA puerta permitida al cliente service-role (que BYPASSA
 * RLS). Regla dura del proyecto (CLAUDE.md, plan §3): el service role solo se
 * usa en el worker y en el callback SENCE, y SIEMPRE a través de esta capa, que
 * fija y verifica el tenant explícitamente.
 *
 * Cómo protege: el service-role NO respeta RLS, así que cada consulta hecha con
 * él DEBE filtrar por el `tenantId` que este guard fija. `assertTenant(row)`
 * verifica que una fila leída pertenece al tenant esperado antes de usarla;
 * `insert()`/`ensureTenantColumn()` fuerzan la columna `tenant_id` al crear.
 *
 * No es RLS (no puede serlo con service-role), pero centraliza el chequeo en un
 * solo lugar auditable en vez de dispersarlo por cada callback.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class TenantGuardError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TenantGuardError";
  }
}

/** Builder de lectura de supabase-js tras `.from().select()` (soporta más filtros). */
type TenantReadBuilder = ReturnType<ReturnType<SupabaseClient["from"]>["select"]>;

export interface TenantGuard {
  readonly tenantId: string;
  /**
   * Query builder de LECTURA ya filtrado por `tenant_id = tenantId`. Es la vía
   * por defecto: hace imposible olvidar el filtro de tenant en un `select`.
   * Para tablas cuya columna de tenant no es `tenant_id`, pásala como 2º arg.
   */
  from(table: string, tenantColumn?: string): TenantReadBuilder;
  /**
   * Cliente service-role CRUDO. Escapa el filtro automático — úsalo solo para
   * escrituras (con `withTenant`) o casos que no encajan en `from()`, y SIEMPRE
   * filtrando/afirmando el tenant a mano. Preferir `from()`.
   */
  readonly db: SupabaseClient;
  /** Asegura que un valor de tenant_id (de una fila) coincide con el guard. */
  assertTenant(rowTenantId: string | null | undefined): void;
  /** Devuelve el objeto con `tenant_id` forzado al del guard (para inserts). */
  withTenant<T extends Record<string, unknown>>(row: T): T & { tenant_id: string };
}

let cachedClient: SupabaseClient | null = null;

function serviceClient(): SupabaseClient {
  if (cachedClient) return cachedClient;
  const env = serverEnv();
  cachedClient = createClient(env.supabaseUrl, env.supabaseServiceRoleKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  return cachedClient;
}

/**
 * Crea un guard atado a un tenant concreto. `tenantId` debe ser un UUID válido
 * y conocido por el llamador (ej. resuelto por subdominio o traído del callback
 * ya correlacionado). Falla si no lo es.
 */
export function tenantGuard(tenantId: string): TenantGuard {
  if (!UUID_RE.test(tenantId)) {
    throw new TenantGuardError(`tenantGuard requiere un tenantId UUID válido, recibió: ${tenantId}`);
  }
  const db = serviceClient();
  return {
    tenantId,
    db,
    from(table, tenantColumn = "tenant_id") {
      return db.from(table).select("*").eq(tenantColumn, tenantId);
    },
    assertTenant(rowTenantId) {
      if (rowTenantId !== tenantId) {
        throw new TenantGuardError(
          `Cruce de tenant detectado: fila de ${rowTenantId ?? "null"} bajo guard de ${tenantId}`,
        );
      }
    },
    withTenant(row) {
      return { ...row, tenant_id: tenantId };
    },
  };
}
