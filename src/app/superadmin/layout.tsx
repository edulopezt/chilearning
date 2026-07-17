import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { isSuperadmin } from "@/modules/core/domain/rbac";

export const dynamic = "force-dynamic";

/**
 * Área de plataforma (task 5.3, HU-1.1). El gate es por CLAIM `superadmin`
 * (lo emite el Auth Hook desde platform_admins), NUNCA por host/subdominio:
 * cualquier subdominio con un JWT sin el claim ve el mensaje de denegado.
 */
export default async function SuperadminLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (!isSuperadmin(principal)) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{esCL.superadmin.forbidden}</p>
      </main>
    );
  }
  return <>{children}</>;
}
