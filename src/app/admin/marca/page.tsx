import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getBrandingState } from "@/modules/core/branding-service";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { PageHeader } from "@/components/ui/page-header";
import { BrandingEditor } from "./branding-editor";

export const dynamic = "force-dynamic";

/** Editor de marca del tenant (task 1.10, HU-1.2). Solo otec_admin. */
export default async function BrandingPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin"])) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{esCL.branding.forbidden}</p>
      </main>
    );
  }

  const state = await getBrandingState(principal);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader title={esCL.branding.title} description={esCL.branding.intro} />
      <BrandingEditor
        initial={{
          primaryColor: state?.branding.primaryColor ?? "#1e3a8a",
          accentColor: state?.branding.accentColor ?? "#0ea5e9",
          logoUrl: state?.branding.logoUrl ?? "",
          name: state?.name ?? "",
          rut: state?.rut ?? "",
        }}
      />
    </main>
  );
}
