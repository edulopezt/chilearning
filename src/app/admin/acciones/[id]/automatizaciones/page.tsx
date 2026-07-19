import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import { getAutomationConfig } from "@/modules/comunicacion/automation-service";
import { Button } from "@/components/ui/button";
import { buttonVariants } from "@/components/ui/button-variants";
import { Card } from "@/components/ui/card";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";
import { setAutomationAction } from "./actions";

export const dynamic = "force-dynamic";

const t = esCL.automation;

/** Config de automatizaciones por acción (task 3.9, HU-5.9). Staff. */
export default async function AutomationPage({ params }: { params: Promise<{ id: string }> }) {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");
  if (!principal.tenantId || !authorize(principal, principal.tenantId, ["otec_admin", "coordinator"])) {
    return <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6"><p className="text-muted-foreground">{t.forbidden}</p></main>;
  }
  const { id: actionId } = await params;
  const config = await getAutomationConfig(principal, actionId);
  if (config === null) redirect("/admin/acciones");

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader title={t.title} description={t.intro} />

      <ul className="flex flex-col gap-3">
        {config.map((c) => (
          <li key={c.kind}>
            <Card className="gap-3 p-4">
              <form action={setAutomationAction} className="flex flex-col gap-3">
                <input type="hidden" name="actionId" value={actionId} />
                <input type="hidden" name="kind" value={c.kind} />
                <Label className="items-start font-medium">
                  <Checkbox name="enabled" defaultChecked={c.enabled} className="mt-0.5" />
                  <span className="flex-1">{t.kinds[c.kind]}</span>
                </Label>
                {c.kind === "inactive" ? (
                  <Label className="font-normal">
                    <span>{t.inactiveDays}</span>
                    <Input type="number" name="inactiveDays" min={1} max={60} defaultValue={c.settings.inactiveDays ?? 7} className="w-20" />
                  </Label>
                ) : null}
                <Button type="submit" variant="outline" className="self-start">{t.save}</Button>
              </form>
            </Card>
          </li>
        ))}
      </ul>

      <Link href="/admin/acciones" className={cn(buttonVariants({ variant: "ghost", size: "sm" }), "self-start")}>
        {t.backToActions}
      </Link>
    </main>
  );
}
