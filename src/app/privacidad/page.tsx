import type { Metadata } from "next";
import Link from "next/link";

import { esCL } from "@/i18n/es-CL";

import {
  DATA_RIGHTS,
  POLICY_SECTIONS,
  POLICY_UPDATED,
  POLICY_VERSION,
  PROCESSING_ACTIVITIES,
  RETENTION_POLICIES,
  SUBPROCESSORS,
} from "./content";

/**
 * Política de privacidad — BORRADOR (task 5.6, Ley 21.719, spec §9).
 *
 * Página PÚBLICA y estática: la referencia la landing y también los alumnos
 * antes de tener cuenta, así que no puede exigir login (`/privacidad` está en
 * PUBLIC_PATHS del middleware).
 *
 * ⚠ Es un BORRADOR pendiente de revisión de abogado y lo dice arriba de todo,
 * de forma imposible de no ver. No es la política vigente.
 *
 * Las tablas de tratamientos y de retención se generan desde el catálogo de
 * dominio (`src/modules/core/domain/privacy.ts`), el MISMO que alimenta
 * /mis-datos: así la política publicada no puede contradecir lo que la app
 * hace de verdad ni quedarse atrás cuando el catálogo cambie.
 */

const t = esCL.privacyPolicy;
const p = esCL.privacy;

export const metadata: Metadata = {
  title: `${t.title} — ${esCL.common.appName}`,
  description: t.draftTitle,
  // Es un borrador: que no se indexe ni se cite como la política vigente.
  robots: { index: false, follow: true },
};

const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

/** Párrafos con "•" son ítems de lista; se renderizan con sangría. */
function Paragraph({ text }: { readonly text: string }) {
  const isBullet = text.startsWith("•");
  return (
    <p className={`text-muted-foreground text-sm text-pretty sm:text-base ${isBullet ? "pl-4" : ""}`}>
      {text}
    </p>
  );
}

export default function PrivacyPage() {
  return (
    <div className="flex min-h-dvh flex-col">
      <nav aria-label={esCL.landing.title} className="border-b">
        <div className="mx-auto flex w-full max-w-3xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <span className="text-lg font-bold tracking-tight">{esCL.landing.title}</span>
          <Link
            href="/"
            className={`inline-flex min-h-11 items-center rounded-md px-3 text-sm font-medium hover:bg-muted ${FOCUS_RING}`}
          >
            {t.backHome}
          </Link>
        </div>
      </nav>

      <main className="mx-auto w-full max-w-3xl flex-1 px-4 py-10 sm:px-6 sm:py-14">
        {/* Banner de borrador — lo primero que se ve, con role=alert */}
        <div
          role="alert"
          className="flex flex-col gap-2 rounded-lg border-2 border-destructive bg-destructive/10 p-4 sm:p-5"
        >
          <p className="flex flex-wrap items-center gap-2">
            <span className="rounded bg-destructive px-2 py-0.5 text-xs font-bold tracking-wide text-white">
              {t.draftBadge}
            </span>
            <strong className="text-sm font-bold sm:text-base">{t.draftTitle}</strong>
          </p>
          <p className="text-sm text-pretty">{t.draftBody}</p>
        </div>

        <header className="mt-10 flex flex-col gap-2">
          <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{t.title}</h1>
          <p className="text-muted-foreground text-sm">
            {t.versionLabel} {POLICY_VERSION} · {t.updatedLabel} {POLICY_UPDATED}
          </p>
        </header>

        {/* Índice */}
        <nav aria-labelledby="indice" className="mt-8 rounded-lg border p-4 sm:p-5">
          <h2 id="indice" className="text-sm font-semibold">
            {t.tocTitle}
          </h2>
          <ol className="mt-3 flex flex-col gap-1">
            {POLICY_SECTIONS.map((section) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className={`inline-flex min-h-11 items-center text-sm underline underline-offset-4 hover:text-muted-foreground sm:min-h-0 sm:py-1 ${FOCUS_RING}`}
                >
                  {section.heading}
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <div className="mt-10 flex flex-col gap-10">
          {POLICY_SECTIONS.map((section) => (
            <section key={section.id} aria-labelledby={section.id} className="flex flex-col gap-3">
              <h2 id={section.id} className="scroll-mt-6 text-xl font-bold tracking-tight sm:text-2xl">
                {section.heading}
              </h2>
              {section.paragraphs.map((text) => (
                <Paragraph key={text} text={text} />
              ))}

              {/* Registro de tratamientos — desde el catálogo de dominio */}
              {section.id === "finalidades" ? (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
                    <caption className="sr-only">{p.processingTitle}</caption>
                    <thead>
                      <tr className="border-b">
                        <th scope="col" className="py-2 pr-3 font-semibold">{p.colPurpose}</th>
                        <th scope="col" className="py-2 pr-3 font-semibold">{p.colCategories}</th>
                        <th scope="col" className="py-2 font-semibold">{p.colBasis}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {PROCESSING_ACTIVITIES.map((activity) => (
                        <tr key={activity.purpose} className="border-b align-top">
                          <td className="py-2 pr-3">{activity.purpose}</td>
                          <td className="text-muted-foreground py-2 pr-3">{activity.dataCategories}</td>
                          <td className="text-muted-foreground py-2">{activity.basis}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {/* Subencargados */}
              {section.id === "encargados" ? (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
                    <caption className="sr-only">{section.heading}</caption>
                    <thead>
                      <tr className="border-b">
                        <th scope="col" className="py-2 pr-3 font-semibold">Proveedor</th>
                        <th scope="col" className="py-2 pr-3 font-semibold">Para qué</th>
                        <th scope="col" className="py-2 font-semibold">Dónde</th>
                      </tr>
                    </thead>
                    <tbody>
                      {SUBPROCESSORS.map((sub) => (
                        <tr key={sub.name} className="border-b align-top">
                          <td className="py-2 pr-3 font-medium">
                            {sub.name}
                            {sub.conditional ? (
                              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal">
                                {t.pendingLabel}
                              </span>
                            ) : null}
                          </td>
                          <td className="text-muted-foreground py-2 pr-3">{sub.purpose}</td>
                          <td className="text-muted-foreground py-2">{sub.location}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {/* Retención — desde el catálogo de dominio */}
              {section.id === "retencion" ? (
                <div className="mt-2 overflow-x-auto">
                  <table className="w-full min-w-[36rem] border-collapse text-left text-sm">
                    <caption className="sr-only">{p.retentionTitle}</caption>
                    <thead>
                      <tr className="border-b">
                        <th scope="col" className="py-2 pr-3 font-semibold">{p.colDataType}</th>
                        <th scope="col" className="py-2 pr-3 font-semibold">{p.colRetention}</th>
                        <th scope="col" className="py-2 font-semibold">{p.colBasis}</th>
                      </tr>
                    </thead>
                    <tbody>
                      {RETENTION_POLICIES.map((policy) => (
                        <tr key={policy.dataType} className="border-b align-top">
                          <td className="py-2 pr-3">
                            {policy.dataType}
                            <span className="text-muted-foreground ml-2 text-xs">
                              ({policy.retained ? p.retainedBadge : p.erasableBadge})
                            </span>
                          </td>
                          <td className="py-2 pr-3">{policy.periodLabel}</td>
                          <td className="text-muted-foreground py-2">{policy.basis}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : null}

              {/* Derechos + puente al flujo real ya construido (task 3.5) */}
              {section.id === "derechos" ? (
                <>
                  <dl className="mt-2 flex flex-col gap-2">
                    {DATA_RIGHTS.map((right) => (
                      <div key={right.name} className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                        <dt className="text-sm font-semibold sm:min-w-32">{right.name}</dt>
                        <dd className="text-muted-foreground text-sm">{right.description}</dd>
                      </div>
                    ))}
                  </dl>
                  <div className="mt-4 flex flex-col gap-2 rounded-lg border bg-muted/40 p-4">
                    <h3 className="text-sm font-semibold">{t.rightsCtaTitle}</h3>
                    <p className="text-muted-foreground text-sm text-pretty">{t.rightsCtaBody}</p>
                    <Link
                      href="/mis-datos"
                      className={`inline-flex min-h-11 w-fit items-center rounded-md bg-foreground px-4 text-sm font-medium text-background hover:opacity-90 ${FOCUS_RING}`}
                    >
                      {t.rightsCtaLink}
                    </Link>
                  </div>
                </>
              ) : null}
            </section>
          ))}
        </div>
      </main>

      <footer className="border-t">
        <div className="mx-auto w-full max-w-3xl px-4 py-8 sm:px-6">
          <Link
            href="/"
            className={`inline-flex min-h-11 items-center text-sm font-medium underline underline-offset-4 hover:text-muted-foreground ${FOCUS_RING}`}
          >
            {t.backHome}
          </Link>
        </div>
      </footer>
    </div>
  );
}
