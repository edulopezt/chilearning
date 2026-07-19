import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getBrandingState } from "@/modules/core/branding-service";
import { renderInvitationEmail, renderWelcomeEmail, type RenderedEmail } from "@/modules/comunicacion/domain/email-templates";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { PageHeader } from "@/components/ui/page-header";

export const dynamic = "force-dynamic";

function Preview({ title, email }: { title: string; email: RenderedEmail }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-lg font-semibold">{title}</h2>
      <p className="text-sm">
        <span className="text-muted-foreground">{esCL.emails.subjectLabel}</span> {email.subject}
      </p>
      <div className="overflow-hidden rounded-lg border">
        <iframe title={title} srcDoc={email.html} className="h-[28rem] w-full" sandbox="" />
      </div>
    </section>
  );
}

export default async function EmailsPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin"])) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{esCL.emails.forbidden}</p>
      </main>
    );
  }

  const state = await getBrandingState(principal);
  const brand = {
    orgName: state?.name || "Chilearning",
    primaryColor: state?.branding.primaryColor ?? "#1e3a8a",
  };

  const invitation = renderInvitationEmail({
    brand,
    recipientName: "Ana Díaz",
    acceptUrl: "https://seminarea.chilearning.cl/login",
  });
  const welcome = renderWelcomeEmail({
    brand,
    recipientName: "Ana Díaz",
    courseName: "Prevención de riesgos e-learning",
    courseUrl: "https://seminarea.chilearning.cl/mi-curso",
  });

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-8 p-4 sm:p-6">
      <PageHeader title={esCL.emails.title} description={esCL.emails.intro} />
      <Preview title={esCL.emails.invitationTitle} email={invitation} />
      <Preview title={esCL.emails.welcomeTitle} email={welcome} />
      <p className="rounded-md border border-dashed p-3 text-xs text-muted-foreground">{esCL.emails.note}</p>
    </main>
  );
}
