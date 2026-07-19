import Link from "next/link";
import { redirect } from "next/navigation";
import { InboxIcon } from "lucide-react";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { isSuperadmin } from "@/modules/core/domain/rbac";
import { navForRoles } from "@/components/shell/nav-config";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { EmptyState } from "@/components/ui/empty-state";
import { PageHeader } from "@/components/ui/page-header";
import { cn } from "@/lib/utils";

const t = esCL.dashboard;

/**
 * Home del alumno/staff (HU-2.1/2.3, rediseñado task 6.7): una tarjeta por
 * área alcanzable — misma fuente que el sidebar (`navForRoles`), así que
 * nunca se desincroniza de lo que el usuario realmente puede hacer.
 */
export default async function DashboardPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  // El fiscalizador puro va directo a su portal simplificado (task 2.5,
  // HU-12.2 "sin el ruido del LMS"); con roles mixtos, ve el panel normal.
  if (principal.roles.length === 1 && principal.roles[0] === "supervisor") {
    redirect("/supervisor");
  }

  const areas = navForRoles(principal);

  return (
    <main className="mx-auto flex w-full max-w-5xl flex-col gap-6 p-4 sm:p-6">
      <PageHeader
        title={t.title}
        description={isSuperadmin(principal) ? t.platformAdmin : undefined}
        actions={
          <div className="flex flex-wrap gap-1.5">
            {principal.roles.map((role) => (
              <Badge key={role} variant="secondary">
                {role}
              </Badge>
            ))}
          </div>
        }
      />

      {areas.length === 0 ? (
        <EmptyState icon={<InboxIcon />} title={t.noAccessTitle} description={t.noAccessDescription} />
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {areas.map((area) => {
            const Icon = area.icon;
            return (
              <Card key={area.key} className="gap-4">
                <CardHeader>
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 shrink-0 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Icon className="size-5" />
                    </div>
                    <CardTitle>{area.label}</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="flex flex-col gap-3">
                  <Link href={area.href} className={cn(buttonVariants({ variant: "outline", size: "sm" }), "self-start")}>
                    {t.open}
                  </Link>
                  {area.items.length > 1 ? (
                    <ul className="flex flex-col gap-1">
                      {area.items.slice(0, 4).map((item) => (
                        <li key={item.href}>
                          <Link
                            href={item.href}
                            className="text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
                          >
                            {item.label}
                          </Link>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                </CardContent>
              </Card>
            );
          })}
        </div>
      )}
    </main>
  );
}
