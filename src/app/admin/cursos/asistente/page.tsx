import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { listDrafts } from "@/modules/academico/wizard-service";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
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
  const drafts = allDrafts.filter((d) => d.status === "in_progress");
  // Borradores YA generados: el .docx del descriptor queda archivado y el
  // curso sigue existiendo, pero `[draftId]/page.tsx` redirige lejos de ellos
  // (ya no son editables) — sin esta sección, ni el curso ni el descriptor
  // quedaban alcanzables desde ninguna pantalla (4-ojos MED, CA incumplido).
  const generatedDrafts = allDrafts.filter((d) => d.status === "generated");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-8 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      <section className="flex flex-col gap-3">
        <h2 className="text-lg font-semibold">{t.draftsTitle}</h2>
        {drafts.length === 0 ? (
          <p className="text-muted-foreground text-sm">{t.draftsEmpty}</p>
        ) : (
          <>
            {/* Tabla ≥sm, tarjetas <sm (RNF-6) */}
            <div className="hidden overflow-x-auto sm:block">
              <table className="w-full min-w-[36rem] border-collapse text-sm">
                <thead>
                  <tr className="border-b text-left">
                    <th className="py-2 pr-3">{t.colSource}</th>
                    <th className="py-2 pr-3">{t.colStep}</th>
                    <th className="py-2 pr-3">{t.colUpdated}</th>
                    <th className="py-2" />
                  </tr>
                </thead>
                <tbody>
                  {drafts.map((d) => (
                    <tr key={d.id} className="border-b last:border-0">
                      <td className="py-2 pr-3">{SOURCE_LABEL[d.source] ?? d.source}</td>
                      <td className="py-2 pr-3">{STEP_LABEL[d.currentStep] ?? d.currentStep}</td>
                      <td className="py-2 pr-3">{new Date(d.updatedAt).toLocaleString("es-CL")}</td>
                      <td className="py-2">
                        <span className="flex flex-wrap items-center gap-3">
                          <Link href={`/admin/cursos/asistente/${d.id}`} className="text-sm underline">
                            {t.resume}
                          </Link>
                          <DiscardButton draftId={d.id} />
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <ul className="flex flex-col gap-2 sm:hidden">
              {drafts.map((d) => (
                <li key={d.id} className="flex flex-col gap-2 rounded-lg border p-3 text-sm">
                  <span className="font-medium">
                    {SOURCE_LABEL[d.source] ?? d.source} · {STEP_LABEL[d.currentStep] ?? d.currentStep}
                  </span>
                  <span className="text-muted-foreground text-xs">{new Date(d.updatedAt).toLocaleString("es-CL")}</span>
                  <span className="flex items-center gap-3">
                    <Link href={`/admin/cursos/asistente/${d.id}`} className="underline">
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
                <span className="text-muted-foreground text-xs">{new Date(d.updatedAt).toLocaleString("es-CL")}</span>
                {d.generatedCourseId ? (
                  <Link href={`/admin/cursos/${d.generatedCourseId}/lecciones`} className="underline">
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

      <Link href="/admin/cursos" className="text-sm underline">
        {t.backToCourses}
      </Link>
    </main>
  );
}
