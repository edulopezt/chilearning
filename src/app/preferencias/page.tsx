import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { getMyOptOuts, type OptOutChannel } from "@/modules/comunicacion/automation-service";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { toggleOptOutAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.optout;

/** Preferencias de comunicación del alumno (task 3.9): opt-out auto-servicio. */
export default async function PreferencesPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  const optOuts = new Set(await getMyOptOuts(principal));

  const channels: { key: OptOutChannel; label: string }[] = [
    { key: "email", label: t.email },
    { key: "whatsapp", label: t.whatsapp },
  ];
  const ts = esCL.shell;

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{t.title}</h1>
        <p className="text-muted-foreground text-sm">{t.intro}</p>
      </header>

      <Card className="flex-row items-center justify-between gap-3 p-4">
        <div>
          <p className="font-medium">{ts.appearanceTitle}</p>
          <p className="text-sm text-muted-foreground">{ts.appearanceDescription}</p>
        </div>
        <ThemeToggle />
      </Card>

      <ul className="flex flex-col gap-3">
        {channels.map((c) => {
          const isOut = optOuts.has(c.key);
          return (
            <li key={c.key}>
              <Card className="flex-row flex-wrap items-center gap-3 p-4 text-sm">
                <div className="flex-1">
                  <p className="font-medium">{c.label}</p>
                  <p className={isOut ? "text-warning" : "text-success"}>{isOut ? t.optedOut : t.receiving}</p>
                </div>
                <form action={toggleOptOutAction}>
                  <input type="hidden" name="channel" value={c.key} />
                  <input type="hidden" name="optedOut" value={isOut ? "false" : "true"} />
                  <Button type="submit" variant="outline" size="sm">
                    {isOut ? t.resubscribe : t.unsubscribe}
                  </Button>
                </form>
              </Card>
            </li>
          );
        })}
      </ul>
    </main>
  );
}
