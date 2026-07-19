import { headers } from "next/headers"
import { redirect } from "next/navigation"

import { esCL } from "@/i18n/es-CL"
import { getPrincipal } from "@/modules/core/auth/session"
import { getPublicBranding } from "@/modules/core/public-branding"

import { Sidebar } from "./sidebar"
import { TenantBrandStyle } from "./tenant-brand-style"
import { Topbar } from "./topbar"

/**
 * Shell de la app autenticada (task 6.7): topbar + sidebar (persistente en
 * desktop ≥lg, drawer en móvil) + skip-link. Solo pasa `roles`/`tenantName`/
 * `logoUrl` (serializables) a los Client Components — nunca `NavArea[]` con
 * referencias a íconos, que rompería la serialización RSC server→client.
 */
async function AppShell({ children }: { children: React.ReactNode }) {
  const principal = await getPrincipal()
  if (!principal) redirect("/login")

  const slug = (await headers()).get("x-tenant-slug")
  const branding = slug ? await getPublicBranding(slug) : null
  const tenantName = branding?.name || esCL.common.appName
  const logoUrl = branding?.logoUrl ?? null

  return (
    <div className="flex min-h-dvh flex-col bg-background">
      <TenantBrandStyle />
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:top-2 focus:left-2 focus:z-50 focus:rounded-md focus:bg-primary focus:px-4 focus:py-2 focus:text-primary-foreground"
      >
        {esCL.shell.skipToContent}
      </a>
      <Topbar roles={principal.roles} tenantName={tenantName} logoUrl={logoUrl} />
      <div className="flex flex-1">
        <aside className="hidden w-64 shrink-0 border-r bg-sidebar lg:block">
          <Sidebar roles={principal.roles} />
        </aside>
        <div id="main-content" className="min-w-0 flex-1">
          {children}
        </div>
      </div>
    </div>
  )
}

export { AppShell }
