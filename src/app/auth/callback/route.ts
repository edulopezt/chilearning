import { type NextRequest, NextResponse } from "next/server";

import { safeRedirectPath } from "@/lib/safe-redirect";
import { createSupabaseServerClient } from "@/lib/supabase/server";

/**
 * Callback del magic link (task 1.9, HU-2.1). Supabase redirige aquí con un
 * `code`; se intercambia por una sesión (cookies) y se manda al alumno a su
 * destino. La redirección es RELATIVA (Location: /ruta): el navegador la
 * resuelve contra el origin público real, evitando el problema del origin
 * interno detrás del proxy.
 */
export async function GET(request: NextRequest): Promise<Response> {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeRedirectPath(url.searchParams.get("next")); // anti open-redirect

  if (!code) {
    return new NextResponse(null, { status: 303, headers: { Location: "/login?error=magic" } });
  }

  const supabase = await createSupabaseServerClient();
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return new NextResponse(null, { status: 303, headers: { Location: "/login?error=magic" } });
  }

  return new NextResponse(null, { status: 303, headers: { Location: next } });
}
