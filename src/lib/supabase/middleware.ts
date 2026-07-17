import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicEnv } from "@/lib/env";
import { resolveTenantFromHost, suspendedRequestAction } from "@/modules/core/domain/tenant";

/**
 * Rutas accesibles sin sesión. El resto de la app exige login.
 * Cada entrada abre la ruta EXACTA y todo su subárbol (`/verificar/<token>`).
 */
const PUBLIC_PATHS = ["/login", "/auth", "/_next", "/favicon.ico", "/api/sence", "/verificar", "/api/health", "/suspendido", "/privacidad"];

/**
 * @param isTenantHost True si el host es el subdominio de un tenant (hay slug).
 */
function isPublicPath(pathname: string, isTenantHost: boolean): boolean {
  // La raíz exacta = landing comercial (task 5.6): pública SOLO en el dominio
  // raíz, que es el que vende. En `{otec}.chilearning.cl` la puerta de entrada
  // sigue siendo el login del OTEC: un alumno no puede aterrizar en el pitch
  // comercial del proveedor (con la marca "Chilearning" en vez de la del OTEC,
  // ignorando su branding de HU-1.10), y Google no indexa la misma página de
  // marketing duplicada en cada subdominio del wildcard.
  // Va como caso aparte y NO como entrada de PUBLIC_PATHS: con el prefijo "/"
  // la comparación `startsWith("/" + "/")` dependería de que Next normalice
  // siempre las barras duplicadas, y una ruta tipo "//admin" pasaría a leerse
  // como pública. Igualdad estricta = sin superficie de bypass.
  if (pathname === "/") return !isTenantHost;
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/**
 * Caché module-level del estado del tenant por slug (HU-1.4): evita un RPC por
 * request. Vive por instancia del runtime del middleware; el AVISO de
 * suspensión se propaga en ≤30 s. El corte del plano de datos NO depende de
 * esta caché: `jwt_tenant_id()` valida el estado del tenant en la BD
 * (migración 20260717010000) y deniega al instante incluso con tokens vigentes.
 */
const STATUS_TTL_MS = 30_000;
const STATUS_CACHE_MAX = 1000;
const statusCache = new Map<string, { status: string | null; exp: number }>();

function cacheStatus(slug: string, status: string | null, now: number): void {
  // Cota dura: el slug deriva del header Host (wildcard DNS), controlado por el
  // cliente. Sin evicción, iterar subdominios aleatorios crecería el Map sin
  // límite. Al tope se purgan los expirados y, si no basta, el más antiguo
  // (el orden de iteración del Map es el de inserción).
  if (statusCache.size >= STATUS_CACHE_MAX && !statusCache.has(slug)) {
    for (const [key, value] of statusCache) {
      if (value.exp <= now) statusCache.delete(key);
    }
    if (statusCache.size >= STATUS_CACHE_MAX) {
      const oldest = statusCache.keys().next().value;
      if (oldest !== undefined) statusCache.delete(oldest);
    }
  }
  statusCache.set(slug, { status, exp: now + STATUS_TTL_MS });
}

async function tenantStatusBySlug(supabase: SupabaseClient, slug: string): Promise<string | null> {
  const now = Date.now();
  const hit = statusCache.get(slug);
  if (hit && hit.exp > now) return hit.status;
  const { data, error } = await supabase.rpc("tenant_status_by_slug", { p_slug: slug });
  if (error) {
    // Falla ABIERTO: una caída del RPC no puede tumbar la plataforma completa.
    // Se conserva el último estado conocido (si lo hay) sin renovar el TTL.
    return hit?.status ?? null;
  }
  const status = typeof data === "string" ? data : null;
  cacheStatus(slug, status, now);
  return status;
}

/**
 * Refresca la sesión de Supabase (obligatorio para que la auth SSR funcione),
 * resuelve el tenant por subdominio y protege las rutas privadas.
 *
 * IMPORTANTE (patrón oficial Supabase): NO se debe insertar lógica entre crear
 * el cliente y `getUser()`, ni devolver una response distinta de la que trae las
 * cookies refrescadas, o la sesión se desincroniza.
 */
export async function updateSession(request: NextRequest): Promise<NextResponse> {
  const env = getPublicEnv();

  // Resuelve el tenant del subdominio y lo inyecta en los headers de la REQUEST
  // (para que lo lean los Server Components/Route Handlers). Se BORRA primero el
  // header entrante: un cliente NO puede suplantar su tenant enviándolo él mismo.
  const requestHeaders = new Headers(request.headers);
  requestHeaders.delete("x-tenant-slug");
  const resolution = resolveTenantFromHost(request.headers.get("host"), env.tenantRootDomain);
  if (resolution.slug) {
    requestHeaders.set("x-tenant-slug", resolution.slug);
  }

  let response = NextResponse.next({ request: { headers: requestHeaders } });

  const supabase = createServerClient(env.supabaseUrl, env.supabaseAnonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        for (const { name, value } of cookiesToSet) {
          request.cookies.set(name, value);
        }
        response = NextResponse.next({ request: { headers: requestHeaders } });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, options);
        }
      },
    },
  });

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { pathname } = request.nextUrl;

  // Tenant suspendido (HU-1.4): el subdominio muestra el aviso, también sin
  // sesión. Va DESPUÉS de getUser() (patrón oficial: nada entre crear el
  // cliente y getUser()) y la reescritura CONSERVA las cookies refrescadas.
  // EXENCIONES (revisión 4-ojos): el callback SENCE, /api/health y /verificar
  // pasan SIEMPRE (ver suspendedRequestAction) — suspender no puede destruir
  // evidencia de asistencia (I-1) ni cegar el monitoreo. El resto de /api/*
  // recibe 403 JSON explícito en vez del HTML del aviso.
  if (resolution.slug) {
    const status = await tenantStatusBySlug(supabase, resolution.slug);
    if (status === "suspended") {
      const action = suspendedRequestAction(pathname);
      if (action === "block_api") {
        const blocked = NextResponse.json({ error: "tenant_suspended" }, { status: 403 });
        for (const cookie of response.cookies.getAll()) {
          blocked.cookies.set(cookie);
        }
        return blocked;
      }
      if (action === "rewrite") {
        const url = request.nextUrl.clone();
        url.pathname = "/suspendido";
        const rewrite = NextResponse.rewrite(url, { request: { headers: requestHeaders } });
        for (const cookie of response.cookies.getAll()) {
          rewrite.cookies.set(cookie);
        }
        return rewrite;
      }
      // "allow": endpoint exento (o ya está en /suspendido) → flujo normal.
    } else if (pathname === "/suspendido") {
      // Tenant ACTIVO: /suspendido directo sería un aviso falso compartible.
      const homeUrl = request.nextUrl.clone();
      homeUrl.pathname = "/";
      homeUrl.search = "";
      return NextResponse.redirect(homeUrl);
    }
  } else if (pathname === "/suspendido") {
    // Host sin tenant (dominio raíz / reservado): el aviso no aplica.
    const homeUrl = request.nextUrl.clone();
    homeUrl.pathname = "/";
    homeUrl.search = "";
    return NextResponse.redirect(homeUrl);
  }

  if (!user && !isPublicPath(pathname, resolution.slug !== null)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
