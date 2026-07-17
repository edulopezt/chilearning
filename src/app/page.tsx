import Link from "next/link";

import { esCL } from "@/i18n/es-CL";

/**
 * Landing comercial PROVISIONAL (task 5.6, Plan §13.3).
 *
 * ⚠ MARCA PROVISIONAL: "Chilearning" es la marca de trabajo (D-009 fijó el
 * dominio `chilearning.cl`). La identidad definitiva —nombre, logo, paleta— es
 * una decisión PENDIENTE de Edu; esta página existe para no tener el dominio
 * raíz en blanco mientras tanto. Todos los textos salen de `esCL.landing`, así
 * que un cambio de marca no obliga a tocar este archivo.
 *
 * ⚠ HONESTIDAD COMERCIAL: cada feature descrita corresponde a algo YA
 * construido y verificado contra `specs/ESTADO-PROYECTO.md`. Antes de agregar
 * una tarjeta acá, la funcionalidad tiene que existir en `main`. En particular
 * NO se anuncian: portal de la empresa cliente (5.2), tutor IA (5.8) ni SCORM
 * (5.1) — son backlog del Hito 5.
 *
 * "Construido" ≠ "validado contra el mundo real", y la landing no puede
 * confundirlos:
 * - SENCE: probado contra el MOCK del RCE; la certificación `rcetest` está
 *   PARQUEADA del lado de SENCE y la validación real ocurre en el primer curso
 *   del piloto. Por eso `differentiatorStatus` se renderiza SIEMPRE.
 * - Nada está "en uso": cero cursos dictados, cero clientes, piloto parqueado
 *   (Hito 4). No se afirma tracción ni prueba social.
 *
 * Server Component estático, cero JS de cliente: es la primera impresión del
 * producto y no necesita interactividad. Sin precios y sin formulario (no hay
 * backend de leads); el único CTA es un mailto.
 *
 * Nota de ruteo: esta Home la sirve tanto el dominio raíz como los subdominios
 * de tenant. Por eso el nav lleva "Ingresar": un visitante que cae en
 * `{otec}.chilearning.cl` tiene siempre la puerta al login a la vista.
 */

const t = esCL.landing;

/** Orden de las tarjetas de features (el contenido vive en esCL). */
const FEATURES = [
  t.features.sence,
  t.features.dj,
  t.features.certificates,
  t.features.supervisor,
  t.features.evaluation,
  t.features.dossier,
  t.features.privacy,
  t.features.tenancy,
] as const;

const OTEC_POINTS = [t.otecs.franchise, t.otecs.evidence, t.otecs.solo] as const;

/**
 * ⚠ PENDIENTE DE EDU: apunta al ÚNICO buzón de entrada versionado en el repo
 * (`soporte@chilearning.cl`, el mismo del aviso de OTEC suspendida). Antes
 * apuntaba a `hola@chilearning.cl`, que no está confirmado en ninguna parte:
 * un CTA a una casilla inexistente pierde leads en silencio, sin error ni log.
 * Si Edu crea `hola@`, cambiar esta línea. De todos modos hay que CONFIRMAR que
 * la casilla existe y se lee antes de publicar en el dominio real.
 */
const CONTACT_EMAIL = "soporte@chilearning.cl";

/** Foco visible y touch target ≥44px en todos los CTA (RNF-6, WCAG AA). */
const FOCUS_RING =
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background";

export default function Home() {
  return (
    <div className="flex min-h-dvh flex-col">
      <a
        href="#contenido"
        className={`sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-foreground focus:px-4 focus:py-2 focus:text-background ${FOCUS_RING}`}
      >
        {t.skipToContent}
      </a>

      <nav aria-label={t.title} className="border-b">
        <div className="mx-auto flex w-full max-w-5xl items-center justify-between gap-4 px-4 py-4 sm:px-6">
          <span className="text-lg font-bold tracking-tight">{t.title}</span>
          <Link
            href="/login"
            className={`inline-flex min-h-11 items-center rounded-md px-4 text-sm font-medium hover:bg-muted ${FOCUS_RING}`}
          >
            {t.navLogin}
          </Link>
        </div>
      </nav>

      <main id="contenido" className="flex-1">
        {/* Hero */}
        <section className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
          <h1 className="max-w-3xl text-4xl font-bold tracking-tight text-balance sm:text-5xl">
            {t.tagline}
          </h1>
          <p className="text-muted-foreground mt-6 max-w-2xl text-lg text-pretty">{t.heroLead}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <a
              href={`mailto:${CONTACT_EMAIL}`}
              className={`inline-flex min-h-11 items-center justify-center rounded-md bg-foreground px-5 text-sm font-medium text-background hover:opacity-90 ${FOCUS_RING}`}
            >
              {t.heroCtaContact}
            </a>
            <a
              href="#incluye"
              className={`inline-flex min-h-11 items-center justify-center rounded-md border px-5 text-sm font-medium hover:bg-muted ${FOCUS_RING}`}
            >
              {t.heroCtaFeatures}
            </a>
          </div>
        </section>

        {/* El diferenciador (spec §1) */}
        <section aria-labelledby="diferenciador" className="border-y bg-muted/40">
          <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
            <p className="text-muted-foreground text-xs font-semibold tracking-widest uppercase">
              {t.differentiatorEyebrow}
            </p>
            <h2 id="diferenciador" className="mt-3 max-w-3xl text-2xl font-bold tracking-tight text-balance sm:text-3xl">
              {t.differentiatorTitle}
            </h2>
            <p className="text-muted-foreground mt-4 max-w-3xl text-pretty">{t.differentiatorBody}</p>
            {/*
              El matiz de la certificación va VISIBLE y pegado al diferenciador,
              no escondido en un pie: es el dato que decide la compra de un OTEC
              y el repo no permite afirmar más que esto (rcetest parqueado).
            */}
            <p className="mt-4 max-w-3xl rounded-lg border border-dashed bg-background/60 p-4 text-sm text-pretty">
              {t.differentiatorStatus}
            </p>
          </div>
        </section>

        {/* Features — solo lo que existe hoy */}
        <section aria-labelledby="incluye" className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
          <h2 id="incluye" className="scroll-mt-20 text-2xl font-bold tracking-tight sm:text-3xl">
            {t.featuresTitle}
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl text-pretty">{t.featuresIntro}</p>
          <ul className="mt-10 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {FEATURES.map((feature) => (
              <li key={feature.title} className="flex flex-col gap-2 rounded-lg border p-5">
                <h3 className="font-semibold">{feature.title}</h3>
                <p className="text-muted-foreground text-sm text-pretty">{feature.body}</p>
              </li>
            ))}
          </ul>
        </section>

        {/* Hecho para OTECs chilenas */}
        <section aria-labelledby="otecs" className="border-y bg-muted/40">
          <div className="mx-auto w-full max-w-5xl px-4 py-14 sm:px-6 sm:py-20">
            <h2 id="otecs" className="text-2xl font-bold tracking-tight sm:text-3xl">
              {t.otecsTitle}
            </h2>
            <p className="text-muted-foreground mt-3 max-w-2xl text-pretty">{t.otecsIntro}</p>
            <ul className="mt-10 grid gap-6 sm:grid-cols-3">
              {OTEC_POINTS.map((point) => (
                <li key={point.title} className="flex flex-col gap-2">
                  <h3 className="font-semibold">{point.title}</h3>
                  <p className="text-muted-foreground text-sm text-pretty">{point.body}</p>
                </li>
              ))}
            </ul>
          </div>
        </section>

        {/* CTA de contacto — mailto, sin formulario ni precios */}
        <section aria-labelledby="contacto" className="mx-auto w-full max-w-5xl px-4 py-16 sm:px-6 sm:py-24">
          <h2 id="contacto" className="text-2xl font-bold tracking-tight sm:text-3xl">
            {t.contactTitle}
          </h2>
          <p className="text-muted-foreground mt-3 max-w-2xl text-pretty">{t.contactBody}</p>
          <a
            href={`mailto:${CONTACT_EMAIL}`}
            className={`mt-8 inline-flex min-h-11 items-center justify-center rounded-md bg-foreground px-5 text-sm font-medium text-background hover:opacity-90 ${FOCUS_RING}`}
          >
            {t.contactCta}
            <span className="sr-only">: {CONTACT_EMAIL}</span>
          </a>
        </section>
      </main>

      <footer className="border-t">
        <div className="mx-auto flex w-full max-w-5xl flex-col gap-4 px-4 py-8 sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p className="text-muted-foreground text-sm text-pretty">{t.footerTagline}</p>
          <Link
            href="/privacidad"
            className={`inline-flex min-h-11 w-fit items-center rounded-md text-sm font-medium underline underline-offset-4 hover:text-muted-foreground ${FOCUS_RING}`}
          >
            {t.footerPrivacy}
          </Link>
        </div>
      </footer>
    </div>
  );
}
