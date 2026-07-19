import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { listDrafts } from "@/modules/academico/wizard-service";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { DescriptorDownloadButton } from "./descriptor-download-button";
import { DiscardButton } from "./discard-button";
import { NewDraftForms } from "./new-draft-forms";

export const dynamic = "force-dynamic";

const t = esCL.wizard;

const SOURCE_LABEL: Record<string, string> = { scratch: t.sourceScratch, descriptor: t.sourceDescriptor };
const STEP_LABEL: Record<string, string> = {
  datos: t.stepDatos,
  estructura: t.stepEstructura,
  aprendizajes: t.stepAprendizajes,
  contenido: t.stepContenido,
  evaluaciones: t.stepEvaluaciones,
  completitud: t.stepCompletitud,
  revision: t.stepRevision,
};
// "in_progress" no lleva etiqueta (el "Paso" ya lo dice); "processing"/"failed"
// (fix de seguridad post-5.10: el .docx del descriptor se analiza en el
// worker, no al subirlo) sí necesitan una — sin esto desaparecían de esta
// lista apenas dejaban de ser "in_progress" sin quedar alcanzables en
// ninguna otra pantalla.
const STATUS_LABEL: Record<string, string> = { processing: t.statusProcessing, failed: t.statusFailed };
const DESCRIPTOR_ERROR_LABELS: Record<string, string> = t.descriptorErrors;

function descriptorErrorMessage(errorCode: string | null): string {
  return (errorCode && DESCRIPTOR_ERROR_LABELS[errorCode]) || t.descriptorErrorGeneric;
}

/** Punto de entrada del asistente guiado de creación de cursos (task 5.10, HU-3.5/4.5). */
export default async function CourseWizardIndexPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator"])) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{t.forbidden}</p>
      </main>
    );
  }

  const allDrafts = await listDrafts(principal);
  const drafts = allDrafts.filter((d) => d.status === "in_progress" || d.status === "processing" || d.status === "failed");
  // Borradores YA generados: el .docx del descriptor queda archivado y el
  // curso sigue existiendo, pero `[draftId]/page.tsx` redirige lejos de ellos
  // (ya no son editables) — sin esta sección, ni el curso ni el descriptor
  // quedaban alcanzables desde ninguna pantalla (4-ojos MED, CA incumplido).
  const generatedDrafts = allDrafts.filter((d) => d.status === "generated");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <PageHeader title={t.title} description={t.intro} />

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.draftsTitle}</h2>
        {drafts.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t.draftsEmpty}</p>
        ) : (
          <>
            {/* Tabla ≥sm, tarjetas <sm (RNF-6) */}
            <div className="hidden sm:block">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t.colSource}</TableHead>
                    <TableHead>{t.colStep}</TableHead>
                    <TableHead>{t.colUpdated}</TableHead>
                    <TableHead />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {drafts.map((d) => (
                    <TableRow key={d.id}>
                      <TableCell>{SOURCE_LABEL[d.source] ?? d.source}</TableCell>
                      <TableCell>
                        <span title={d.status === "failed" ? descriptorErrorMessage(d.descriptorError) : undefined}>
                          {STATUS_LABEL[d.status] ?? STEP_LABEL[d.currentStep] ?? d.currentStep}
                        </span>
                      </TableCell>
                      <TableCell>{new Date(d.updatedAt).toLocaleString("es-CL")}</TableCell>
                      <TableCell>
                        <span className="flex flex-wrap items-center gap-3">
                          <Link href={`/admin/cursos/asistente/${d.id}`} className="text-sm underline underline-offset-4">
                            {t.resume}
                          </Link>
                          <DiscardButton draftId={d.id} />
                        </span>
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
            <ul className="flex flex-col gap-2 sm:hidden">
              {drafts.map((d) => (
                <li key={d.id} className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
                  <span className="font-medium">
                    {SOURCE_LABEL[d.source] ?? d.source} · {STATUS_LABEL[d.status] ?? STEP_LABEL[d.currentStep] ?? d.currentStep}
                  </span>
                  {d.status === "failed" ? (
                    <span className="text-xs text-destructive">{descriptorErrorMessage(d.descriptorError)}</span>
                  ) : null}
                  <span className="text-xs text-muted-foreground">{new Date(d.updatedAt).toLocaleString("es-CL")}</span>
                  <span className="flex items-center gap-3">
                    <Link href={`/admin/cursos/asistente/${d.id}`} className="underline underline-offset-4">
                      {t.resume}
                    </Link>
                    <DiscardButton draftId={d.id} />
                  </span>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      {generatedDrafts.length > 0 ? (
        <section className="flex flex-col gap-3">
          <h2 className="text-lg font-semibold">{t.generatedTitle}</h2>
          <ul className="flex flex-col gap-2">
            {generatedDrafts.map((d) => (
              <li key={d.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-3 text-sm">
                <span className="font-medium">{SOURCE_LABEL[d.source] ?? d.source}</span>
                <span className="text-xs text-muted-foreground">{new Date(d.updatedAt).toLocaleString("es-CL")}</span>
                {d.generatedCourseId ? (
                  <Link href={`/admin/cursos/${d.generatedCourseId}/lecciones`} className="underline underline-offset-4">
                    {t.viewCourse}
                  </Link>
                ) : null}
                {d.source === "descriptor" ? <DescriptorDownloadButton draftId={d.id} /> : null}
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <NewDraftForms />

      <Link href="/admin/cursos" className="text-sm underline underline-offset-4">
        {t.backToCourses}
      </Link>
    </main>
  );
}
