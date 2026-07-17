import { NextResponse, type NextRequest } from "next/server";

import { tenantGuard } from "@/lib/tenant-guard";
import { contentTypeFor, sanitizeScormPath } from "@/modules/contenido/domain/scorm-zip";
import { resolveStaffPackageAccess, resolveStudentScormAccess } from "@/modules/contenido/scorm-runtime-service";
import { getPrincipal } from "@/modules/core/auth/session";

/**
 * Proxy SAME-ORIGIN de assets extraídos de un paquete SCORM (task 5.1b,
 * HU-4.2, ADR-006). Decisión de diseño (ver PLAN.md del PR): el SCO busca
 * `window.API`/`window.API_1484_11` subiendo por `window.parent` — eso solo
 * funciona si el iframe es MISMO ORIGEN que la página que lo contiene. Una
 * signed URL de Supabase Storage serviría el contenido desde `*.supabase.co`
 * (otro origen) y el SCO jamás podría reportar progreso. Por eso el asset se
 * DESCARGA en el servidor (autenticado + autorizado) y se reenvía como bytes.
 *
 * Anti-enumeración: cualquier fallo de acceso (paquete inexistente, tenant
 * cruzado, alumno sin inscripción/lección publicada, paquete no `ready`, ruta
 * insegura) responde 404 — NUNCA 403 — para no revelar si el recurso existe.
 */

const BUCKET = "scorm";

function notFound(): NextResponse {
  return NextResponse.json({ error: "not_found" }, { status: 404 });
}

interface ResolvedAsset {
  readonly tenantId: string;
  readonly extractedPrefix: string;
}

/** STAFF de gestión primero (basta con que el paquete sea de su tenant); si no, alumno inscrito. */
async function resolveAssetAccess(
  principal: NonNullable<Awaited<ReturnType<typeof getPrincipal>>>,
  packageId: string,
): Promise<ResolvedAsset | null> {
  const staff = await resolveStaffPackageAccess(principal, packageId);
  if (staff.ok) return { tenantId: staff.access.tenantId, extractedPrefix: staff.access.extractedPrefix };

  const student = await resolveStudentScormAccess(principal, { by: "package", packageId });
  if (student.ok) return { tenantId: student.access.tenantId, extractedPrefix: student.access.extractedPrefix };

  return null;
}

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ packageId: string; path: string[] }> },
): Promise<Response> {
  const principal = await getPrincipal();
  if (!principal) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const { packageId, path } = await params;

  const access = await resolveAssetAccess(principal, packageId);
  if (!access) return notFound();

  // Reensambla el segmento capturado por el catch-all y lo normaliza/valida
  // COMPLETO (colapsa "./", rechaza ".." tras normalizar, "//", rutas
  // absolutas, caracteres de control): un intento de traversal en la URL
  // nunca llega a tocar Storage.
  const sanitized = sanitizeScormPath((path ?? []).join("/"));
  if (!sanitized.ok) return notFound();

  const guard = tenantGuard(access.tenantId);
  const objectPath = `${access.extractedPrefix}/${sanitized.value}`;
  const { data, error } = await guard.db.storage.from(BUCKET).download(objectPath);
  if (error || !data) return notFound();

  return new NextResponse(await data.arrayBuffer(), {
    status: 200,
    headers: {
      "content-type": contentTypeFor(sanitized.value),
      // Privado (requiere sesión) y de corta vida: el navegador puede cachear
      // el asset entre navegaciones del mismo SCO sin re-descargarlo siempre.
      "cache-control": "private, max-age=300",
      "x-content-type-options": "nosniff",
    },
  });
}
