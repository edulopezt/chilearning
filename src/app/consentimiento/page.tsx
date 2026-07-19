import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { acceptConsentAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.privacy;

/** Consentimiento informado (task 3.5, RNF-3). El alumno lo acepta al primer ingreso. */
export default async function ConsentimientoPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-6 p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.consentTitle}</h1>
        <p className="text-sm text-muted-foreground">{t.consentIntro}</p>
      </header>
      <Card>
        <CardContent className="flex flex-col gap-6">
          <p className="text-sm leading-relaxed">{t.consentBody}</p>
          <form action={acceptConsentAction}>
            <Button type="submit">{t.accept}</Button>
          </form>
        </CardContent>
      </Card>
    </main>
  );
}
