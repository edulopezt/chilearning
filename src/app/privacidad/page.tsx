import type { Metadata } from "next";
import Link from "next/link";

import { esCL } from "@/i18n/es-CL";
import { cn } from "@/lib/utils";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card, CardContent } from "@/components/ui/card";
import { Table, TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

import {
  DATA_RIGHTS,
  LEGAL_ENTITY,
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
          <Link href="/" className={cn(buttonVariants({ variant: "ghost", size: "sm" }))}>
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
            {/* `text-background` (no `text-white`): el token invierte con el
                tema. `--destructive` se aclara en dark y el blanco fijo caería
                a ~2.9:1, bajo el 4.5:1 de AA — justo en el elemento del que
                depende todo el aviso legal. */}
            <span className="rounded bg-destructive px-2 py-0.5 text-xs font-bold tracking-wide text-background">
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
        <Card className="mt-8 py-4 sm:py-5">
          <CardContent>
            <nav aria-labelledby="indice">
              <h2 id="indice" className="text-sm font-semibold">
                {t.tocTitle}
              </h2>
              <ol className="mt-3 flex flex-col gap-1">
                {POLICY_SECTIONS.map((section) => (
                  <li key={section.id}>
                    <a
                      href={`#${section.id}`}
                      className="inline-flex min-h-11 items-center text-sm underline underline-offset-4 outline-none hover:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50 sm:min-h-0 sm:py-1"
                    >
                      {section.heading}
                    </a>
                  </li>
                ))}
              </ol>
            </nav>
          </CardContent>
        </Card>

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
                <div className="mt-2">
                  <Table className="min-w-[36rem]">
                    <TableCaption className="sr-only">{p.processingTitle}</TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{p.colPurpose}</TableHead>
                        <TableHead>{p.colCategories}</TableHead>
                        <TableHead>{p.colBasis}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {PROCESSING_ACTIVITIES.map((activity) => (
                        <TableRow key={activity.purpose}>
                          <TableCell className="align-top">{activity.purpose}</TableCell>
                          <TableCell className="align-top text-muted-foreground">{activity.dataCategories}</TableCell>
                          <TableCell className="align-top text-muted-foreground">{activity.basis}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}

              {/* Subencargados */}
              {section.id === "encargados" ? (
                <div className="mt-2">
                  <Table className="min-w-[36rem]">
                    <TableCaption className="sr-only">{section.heading}</TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t.colProvider}</TableHead>
                        <TableHead>{t.colPurposeShort}</TableHead>
                        <TableHead>{t.colLocation}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {SUBPROCESSORS.map((sub) => (
                        <TableRow key={sub.name}>
                          <TableCell className="align-top font-medium">
                            {sub.name}
                            {sub.conditional ? (
                              <span className="ml-2 rounded bg-muted px-1.5 py-0.5 text-xs font-normal">
                                {t.pendingLabel}
                              </span>
                            ) : null}
                          </TableCell>
                          <TableCell className="align-top text-muted-foreground">{sub.purpose}</TableCell>
                          <TableCell className="align-top text-muted-foreground">{sub.location}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}

              {/* Retención — desde el catálogo de dominio */}
              {section.id === "retencion" ? (
                <div className="mt-2">
                  <Table className="min-w-[36rem]">
                    <TableCaption className="sr-only">{p.retentionTitle}</TableCaption>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{p.colDataType}</TableHead>
                        <TableHead>{p.colRetention}</TableHead>
                        <TableHead>{p.colBasis}</TableHead>
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      {RETENTION_POLICIES.map((policy) => (
                        <TableRow key={policy.dataType}>
                          <TableCell className="align-top">
                            {policy.dataType}
                            <span className="ml-2 text-xs text-muted-foreground">
                              ({policy.retained ? p.retainedBadge : p.erasableBadge})
                            </span>
                          </TableCell>
                          <TableCell className="align-top">{policy.periodLabel}</TableCell>
                          <TableCell className="align-top text-muted-foreground">{policy.basis}</TableCell>
                        </TableRow>
                      ))}
                    </TableBody>
                  </Table>
                </div>
              ) : null}

              {/*
                Identificación del prestador. Va RENDERIZADO —y no solo
                declarado en content.ts— porque la Ley 21.719 exige identificar
                al responsable/encargado: si la constante fuera un export
                muerto, Edu rellenaría razón social/RUT/domicilio creyendo que
                cerró el bloqueante #1 de `docs/legal/README.md` y la página
                publicada seguiría sin identificar a nadie, sin error ni test
                rojo. Con los placeholders puestos, el "[POR DEFINIR]" visible
                es exactamente lo que impide publicarlo por descuido.
              */}
              {section.id === "contacto" ? (
                <dl className="mt-2 flex flex-col gap-2 rounded-lg border p-4">
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                    <dt className="text-sm font-semibold sm:min-w-40">{t.legalEntityTitle}</dt>
                    <dd className="text-muted-foreground text-sm">{LEGAL_ENTITY.tradeName}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                    <dt className="text-sm font-semibold sm:min-w-40">{t.legalNameLabel}</dt>
                    <dd className="text-muted-foreground text-sm">{LEGAL_ENTITY.legalName}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                    <dt className="text-sm font-semibold sm:min-w-40">{t.registryLabel}</dt>
                    <dd className="text-muted-foreground text-sm">{LEGAL_ENTITY.registry}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                    <dt className="text-sm font-semibold sm:min-w-40">{t.taxIdLabel}</dt>
                    <dd className="text-muted-foreground text-sm">{LEGAL_ENTITY.taxId}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                    <dt className="text-sm font-semibold sm:min-w-40">{t.addressLabel}</dt>
                    <dd className="text-muted-foreground text-sm">{LEGAL_ENTITY.address}</dd>
                  </div>
                  <div className="flex flex-col gap-0.5 sm:flex-row sm:gap-2">
                    <dt className="text-sm font-semibold sm:min-w-40">{t.legalContactLabel}</dt>
                    <dd className="text-muted-foreground text-sm">{LEGAL_ENTITY.contactEmail}</dd>
                  </div>
                </dl>
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
                    <Link href="/mis-datos" className={cn(buttonVariants({ size: "default" }), "w-fit")}>
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
            className="inline-flex min-h-11 items-center rounded-md text-sm font-medium underline underline-offset-4 outline-none hover:text-muted-foreground focus-visible:ring-3 focus-visible:ring-ring/50"
          >
            {t.backHome}
          </Link>
        </div>
      </footer>
    </div>
  );
}
