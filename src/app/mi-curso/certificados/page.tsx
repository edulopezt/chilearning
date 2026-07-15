import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getMyCertificates } from "@/modules/certificados/certificates-service";

export const dynamic = "force-dynamic";

const t = esCL.certificateStudent;
const SENCE_PORTAL = "https://lce.sence.cl/certificadoasistencia";

/** Certificados del alumno + ayuda para el certificado oficial de SENCE (HU-7.1). */
export default async function MisCertificadosPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const certs = await getMyCertificates(principal);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.sectionTitle}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      {certs.length === 0 ? (
        <p className="text-muted-foreground text-sm">{t.empty}</p>
      ) : (
        <ul className="flex flex-col gap-3">
          {certs.map((c) => (
            <li key={c.id} className="flex flex-wrap items-center gap-3 rounded-lg border p-4">
              <div className="flex flex-1 flex-col">
                <span className="font-medium">{c.courseName}</span>
                <span className="text-xs text-muted-foreground">
                  {esCL.certificates.folio}: {c.folio} · {new Date(c.issuedAt).toLocaleDateString("es-CL")}
                </span>
              </div>
              {c.status === "revoked" ? (
                <span className="rounded bg-red-100 px-2 py-0.5 text-xs text-red-800 dark:bg-red-900 dark:text-red-200">
                  {t.revoked}
                </span>
              ) : (
                <a href={`/api/certificados/${c.id}`} className="min-h-11 rounded-md border px-4 text-sm font-medium">
                  {t.download}
                </a>
              )}
            </li>
          ))}
        </ul>
      )}

      {/* Ayuda: el certificado oficial de SENCE se obtiene en su portal (P3) */}
      <section className="flex flex-col gap-2 rounded-lg border border-dashed p-4">
        <h2 className="font-semibold">{t.senceHelpTitle}</h2>
        <p className="text-muted-foreground text-sm">{t.senceHelpBody}</p>
        <a href={SENCE_PORTAL} target="_blank" rel="noopener noreferrer" className="text-sm font-medium underline">
          {t.senceHelpLink} →
        </a>
      </section>

      <Link href="/mi-curso" className="text-sm underline">
        {t.backToCourse}
      </Link>
    </main>
  );
}
