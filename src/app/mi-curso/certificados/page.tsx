import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getMyCertificates } from "@/modules/certificados/certificates-service";
import { formatExpiryDate } from "@/modules/certificados/domain/expiry-report";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { cn } from "@/lib/utils";

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
        <p className="text-sm text-muted-foreground">{t.intro}</p>
      </header>

      {certs.length === 0 ? (
        <EmptyState title={t.empty} />
      ) : (
        <ul className="flex flex-col gap-3">
          {certs.map((c) => (
            <li key={c.id}>
              <Card className="flex-row flex-wrap items-center gap-3 p-4">
                <div className="flex flex-1 flex-col">
                  <span className="font-medium">{c.courseName}</span>
                  <span className="text-xs text-muted-foreground">
                    {esCL.certificates.folio}: {c.folio} · {new Date(c.issuedAt).toLocaleDateString("es-CL")}
                  </span>
                  {/* Vencimiento del propio certificado (task 5.12, HU-7.3): el
                      titular debe verlo en la app, no solo enterarse por correo. */}
                  {c.expiresAt ? (
                    <span className="mt-1 flex items-center gap-2 text-xs">
                      {esCL.certExpiry.colExpiresOn} {formatExpiryDate(c.expiresAt)}
                      {c.expired ? <Badge variant="destructive">{esCL.certExpiry.expired}</Badge> : null}
                    </span>
                  ) : null}
                </div>
                {c.status === "revoked" ? (
                  <Badge variant="destructive">{t.revoked}</Badge>
                ) : (
                  <a href={`/api/certificados/${c.id}`} className={cn(buttonVariants({ variant: "outline", size: "default" }))}>
                    {t.download}
                  </a>
                )}
              </Card>
            </li>
          ))}
        </ul>
      )}

      {/* Ayuda: el certificado oficial de SENCE se obtiene en su portal (P3) */}
      <section className="flex flex-col gap-2 rounded-lg border border-dashed p-4">
        <h2 className="font-semibold">{t.senceHelpTitle}</h2>
        <p className="text-sm text-muted-foreground">{t.senceHelpBody}</p>
        <a
          href={SENCE_PORTAL}
          target="_blank"
          rel="noopener noreferrer"
          className="text-sm font-medium underline underline-offset-4"
        >
          {t.senceHelpLink} →
        </a>
      </section>

      <Link href="/mi-curso" className="text-sm underline underline-offset-4">
        {t.backToCourse}
      </Link>
    </main>
  );
}
