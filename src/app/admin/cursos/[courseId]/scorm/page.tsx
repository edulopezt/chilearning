import Link from "next/link";
import { PackageIcon } from "lucide-react";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { requireFeature } from "@/lib/feature-flags";
import { tenantGuard } from "@/lib/tenant-guard";
import { listScormPackages, type ScormPackageRow } from "@/modules/contenido/scorm-service";
import { listScormResults, type ScormResultRow } from "@/modules/contenido/scorm-runtime-service";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize, type Principal } from "@/modules/core/domain/rbac";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
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
        <Link href={`/admin/cursos/${courseId}/lecciones`} className="text-sm underline underline-offset-4">
          ← {esCL.lessons.title}
        </Link>
      </main>
    );
  }

  const packages = await listScormPackages(principal, courseId);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <PageHeader title={t.title} description={t.intro} />

      {/* RNF-6: aviso FIJO y siempre visible — la responsividad interna del
          paquete depende de la herramienta de autor, no de Chilearning. */}
      <Alert variant="warning">
        <AlertDescription>{t.responsiveWarning}</AlertDescription>
      </Alert>

      <section className="flex flex-col gap-3">
        {packages.length === 0 ? (
          <EmptyState icon={<PackageIcon />} title={t.empty} />
        ) : (
          <>
            {/* Tabla ≥sm, tarjetas <sm (RNF-6) */}
            <ul className="flex flex-col gap-2 sm:hidden">
              {packages.map((p) => (
                <li key={p.id}>
                  <Card className="gap-1 p-3">
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex flex-col gap-0.5">
                        <span className="font-medium break-words">{p.title}</span>
                        <span className="font-mono text-xs text-muted-foreground">{p.scorm_version ?? "—"}</span>
                      </div>
                      <Badge variant={p.status === "ready" ? "success" : p.status === "error" ? "destructive" : "secondary"}>
                        {STATUS_LABEL[p.status] ?? p.status}
                      </Badge>
                    </div>
                    {p.status === "error" && p.error_code ? (
                      <p className="text-xs text-destructive">{ERROR_LABEL[p.error_code] ?? p.error_code}</p>
                    ) : null}
                    <span className="text-xs text-muted-foreground">{formatSize(p.file_size)}</span>
                    <div className="mt-1 flex justify-end">
                      <PackageRowActions courseId={courseId} pkg={p} />
                    </div>
                  </Card>
                </li>
              ))}
            </ul>
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.colTitle}</TableHead>
                    <TableHead>{t.colVersion}</TableHead>
                    <TableHead>{t.colStatus}</TableHead>
                    <TableHead>{t.colSize}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {packages.map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>{p.title}</TableCell>
                      <TableCell className="font-mono">{p.scorm_version ?? "—"}</TableCell>
                      <TableCell>
                        <Badge variant={p.status === "ready" ? "success" : p.status === "error" ? "destructive" : "secondary"}>
                          {STATUS_LABEL[p.status] ?? p.status}
                        </Badge>
                        {p.status === "error" && p.error_code ? (
                          <p className="mt-1 text-xs text-destructive">{ERROR_LABEL[p.error_code] ?? p.error_code}</p>
                        ) : null}
                      </TableCell>
                      <TableCell>{formatSize(p.file_size)}</TableCell>
                      <TableCell>
                        <PackageRowActions courseId={courseId} pkg={p} />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </>
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

      <Link href={`/admin/cursos/${courseId}/lecciones`} className="text-sm underline underline-offset-4">
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
        <p className="text-sm text-muted-foreground">{t.resultsEmpty}</p>
      ) : (
        <>
          {/* Tabla ≥sm, tarjetas <sm (RNF-6) */}
          <div className="hidden sm:block">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t.studentCol}</TableHead>
                  <TableHead>{t.statusCol}</TableHead>
                  <TableHead>{t.scoreCol}</TableHead>
                  <TableHead>{t.updatedCol}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {results.map((r) => (
                  <ResultRow key={r.enrollmentId} r={r} />
                ))}
              </TableBody>
            </Table>
          </div>
          <ul className="flex flex-col gap-2 sm:hidden">
            {results.map((r) => (
              <li key={r.enrollmentId} className="flex flex-col gap-1 rounded-lg border p-3 text-sm">
                <span className="font-medium">{r.studentName}</span>
                <span className="text-xs text-muted-foreground">
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
    <TableRow>
      <TableCell>{r.studentName}</TableCell>
      <TableCell>{r.lessonStatus ?? "—"}</TableCell>
      <TableCell>{r.scoreRaw ?? "—"}</TableCell>
      <TableCell>{new Date(r.updatedAt).toLocaleString("es-CL")}</TableCell>
    </TableRow>
  );
}
