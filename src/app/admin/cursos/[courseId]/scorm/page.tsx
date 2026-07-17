import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { requireFeature } from "@/lib/feature-flags";
import { tenantGuard } from "@/lib/tenant-guard";
import { listScormPackages, type ScormPackageRow } from "@/modules/contenido/scorm-service";
import { listScormResults, type ScormResultRow } from "@/modules/contenido/scorm-runtime-service";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { PackageRowActions } from "./package-row-actions";
import { UploadForm } from "./upload-form";

export const dynamic = "force-dynamic";

const t = esCL.scorm;

const STATUS_LABEL: Record<string, string> = {
  uploaded: t.statusUploaded,
  processing: t.statusProcessing,
  ready: t.statusReady,
  error: t.statusError,
};

const ERROR_LABEL: Record<string, string> = {
  no_manifest: t.errorNoManifest,
  invalid_manifest: t.errorInvalidManifest,
  entry_missing: t.errorEntryMissing,
  unsafe_path: t.errorUnsafePath,
  too_large: t.errorTooLarge,
  storage_error: t.errorStorage,
};

function formatSize(bytes: number | null): string {
  if (!bytes) return "—";
  const mb = bytes / (1024 * 1024);
  return `${mb < 10 ? mb.toFixed(1) : Math.round(mb)} MB`;
}

/** Ingesta de paquetes SCORM (task 5.1a, HU-4.2, ADR-006): la extracción/validación corre en el worker. */
export default async function ScormPage({ params }: { params: Promise<{ courseId: string }> }) {
  const { courseId } = await params;
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator"])) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.forbidden}</p>
      </main>
    );
  }

  const guard = tenantGuard(principal.tenantId);
  const enabled = await requireFeature(guard, principal.tenantId, "scorm");

  // Deny-by-default (P7): la feature apagada hace DESAPARECER la función
  // completa (ni formulario ni tabla) — no se muestra deshabilitada a medias.
  if (!enabled) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground">{t.flagDisabled}</p>
        <Link href={`/admin/cursos/${courseId}/lecciones`} className="text-sm underline">
          ← {esCL.lessons.title}
        </Link>
      </main>
    );
  }

  const packages = await listScormPackages(principal, courseId);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      {/* RNF-6: aviso FIJO y siempre visible — la responsividad interna del
          paquete depende de la herramienta de autor, no de Chilearning. */}
      <div
        role="note"
        className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100"
      >
        {t.responsiveWarning}
      </div>

      <section className="flex flex-col gap-3">
        {packages.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.empty}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full min-w-[36rem] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3">{t.colTitle}</th>
                  <th className="py-2 pr-3">{t.colVersion}</th>
                  <th className="py-2 pr-3">{t.colStatus}</th>
                  <th className="py-2 pr-3">{t.colSize}</th>
                  <th className="py-2" />
                </tr>
              </thead>
              <tbody>
                {packages.map((p) => (
                  <tr key={p.id} className="border-b last:border-0 align-middle">
                    <td className="py-2 pr-3">{p.title}</td>
                    <td className="py-2 pr-3 font-mono">{p.scorm_version ?? "—"}</td>
                    <td className="py-2 pr-3">
                      <span
                        className={
                          p.status === "ready"
                            ? "text-green-700 dark:text-green-400"
                            : p.status === "error"
                              ? "text-red-600"
                              : "text-muted-foreground"
                        }
                      >
                        {STATUS_LABEL[p.status] ?? p.status}
                      </span>
                      {p.status === "error" && p.error_code ? (
                        <p className="text-xs text-red-600">{ERROR_LABEL[p.error_code] ?? p.error_code}</p>
                      ) : null}
                    </td>
                    <td className="py-2 pr-3">{formatSize(p.file_size)}</td>
                    <td className="py-2">
                      <PackageRowActions courseId={courseId} pkg={p} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section className="flex flex-col gap-3 border-t pt-6">
        <h2 className="text-lg font-semibold">{t.newPackage}</h2>
        <UploadForm courseId={courseId} />
      </section>

      {/* Resultados por paquete (task 5.1b): solo tiene sentido para paquetes
          ya `ready` — los demás nunca acumularon intentos de alumnos. */}
      {packages.filter((p) => p.status === "ready").length > 0 ? (
        <section className="flex flex-col gap-6 border-t pt-6">
          <h2 className="text-lg font-semibold">{t.resultsTitle}</h2>
          {packages
            .filter((p) => p.status === "ready")
            .map((p) => (
              <PackageResults key={p.id} principal={principal} pkg={p} />
            ))}
        </section>
      ) : null}

      <Link href={`/admin/cursos/${courseId}/lecciones`} className="text-sm underline">
        ← {esCL.lessons.title}
      </Link>
    </main>
  );
}

async function PackageResults({ principal, pkg }: { principal: Principal; pkg: ScormPackageRow }) {
  const results = await listScormResults(principal, pkg.id);
  return (
    <div className="flex flex-col gap-2">
      <h3 className="font-medium">{pkg.title}</h3>
      {results.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.resultsEmpty}</p>
      ) : (
        <>
          {/* Tabla ≥sm, tarjetas <sm (RNF-6) */}
          <div className="hidden overflow-x-auto sm:block">
            <table className="w-full min-w-[32rem] border-collapse text-sm">
              <thead>
                <tr className="border-b text-left">
                  <th className="py-2 pr-3">{t.studentCol}</th>
                  <th className="py-2 pr-3">{t.statusCol}</th>
                  <th className="py-2 pr-3">{t.scoreCol}</th>
                  <th className="py-2">{t.updatedCol}</th>
                </tr>
              </thead>
              <tbody>
                {results.map((r) => (
                  <ResultRow key={r.enrollmentId} r={r} />
                ))}
              </tbody>
            </table>
          </div>
          <ul className="flex flex-col gap-2 sm:hidden">
            {results.map((r) => (
              <li key={r.enrollmentId} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                <span className="font-medium">{r.studentName}</span>
                <span className="text-muted-foreground text-xs">
                  {r.lessonStatus ?? "—"} · {t.scoreCol}: {r.scoreRaw ?? "—"} ·{" "}
                  {new Date(r.updatedAt).toLocaleString("es-CL")}
                </span>
              </li>
            ))}
          </ul>
        </>
      )}
    </div>
  );
}

function ResultRow({ r }: { r: ScormResultRow }) {
  return (
    <tr className="border-b last:border-0">
      <td className="py-2 pr-3">{r.studentName}</td>
      <td className="py-2 pr-3">{r.lessonStatus ?? "—"}</td>
      <td className="py-2 pr-3">{r.scoreRaw ?? "—"}</td>
      <td className="py-2">{new Date(r.updatedAt).toLocaleString("es-CL")}</td>
    </tr>
  );
}
