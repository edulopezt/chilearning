import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

import { getPublicEnv } from "@/lib/env";
import { resolveTenantFromHost } from "@/modules/core/domain/tenant";

/** Rutas accesibles sin sesión. El resto de la app exige login. */
const PUBLIC_PATHS = ["/login", "/auth", "/_next", "/favicon.ico", "/api/sence"];

function isPublicPath(pathname: string): boolean {
  return PUBLIC_PATHS.some((p) => pathname === p || pathname.startsWith(`${p}/`));
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
  if (!user && !isPublicPath(pathname)) {
    const loginUrl = request.nextUrl.clone();
    loginUrl.pathname = "/login";
    loginUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(loginUrl);
  }

  return response;
}
