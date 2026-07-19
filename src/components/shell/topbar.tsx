"use client"

import * as React from "react"
import { usePathname } from "next/navigation"
import { MenuIcon } from "lucide-react"

import { esCL } from "@/i18n/es-CL"
import { cn } from "@/lib/utils"
import type { RoleKey } from "@/modules/core/domain/rbac"
import { buttonVariants } from "@/components/ui/button"
import { Sheet, SheetContent, SheetTitle, SheetTrigger } from "@/components/ui/sheet"
import { ThemeToggle } from "@/components/theme/theme-toggle"

import { Sidebar } from "./sidebar"
import { UserMenu } from "./user-menu"

export interface TopbarProps {
  roles: readonly RoleKey[]
  tenantName: string
  logoUrl: string | null
}

function Topbar({ roles, tenantName, logoUrl }: TopbarProps) {
  const pathname = usePathname()
  const [mobileNavOpen, setMobileNavOpen] = React.useState(false)

  // Cierra el drawer móvil al navegar — la navegación dentro de la misma área
  // no remonta el layout (y por lo tanto no el Sheet), así que sin esto el
  // drawer se quedaría abierto tapando la página a la que se acaba de ir.
  // Patrón oficial de React para "resetear estado cuando cambia otro valor"
  // (ajuste durante el render, comparado contra el pathname del render
  // anterior) — no un efecto, así que no cae en la regla que desaconseja
  // llamar setState de forma síncrona dentro de un efecto.
  const [prevPathname, setPrevPathname] = React.useState(pathname)
  if (pathname !== prevPathname) {
    setPrevPathname(pathname)
    setMobileNavOpen(false)
  }

  return (
    <header className="sticky top-0 z-40 flex h-14 shrink-0 items-center gap-2 border-b bg-background px-3 sm:px-4">
      <Sheet open={mobileNavOpen} onOpenChange={setMobileNavOpen}>
        <SheetTrigger
          aria-label={esCL.shell.openMenu}
          className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "lg:hidden")}
        >
          <MenuIcon className="size-5" />
        </SheetTrigger>
        <SheetContent side="left" className="w-72 gap-0 p-0">
          <SheetTitle className="sr-only">{esCL.shell.mainNav}</SheetTitle>
          <div className="flex h-14 items-center gap-2 border-b px-4 font-semibold">
            {logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element -- logo de tenant: URL externa arbitraria, no un asset optimizable por next/image
              <img src={logoUrl} alt="" className="h-6 w-auto" />
            ) : null}
            <span className="truncate">{tenantName}</span>
          </div>
          <Sidebar roles={roles} />
        </SheetContent>
      </Sheet>

      <div className="hidden items-center gap-2 font-semibold lg:flex">
        {logoUrl ? (
          // eslint-disable-next-line @next/next/no-img-element -- logo de tenant: URL externa arbitraria, no un asset optimizable por next/image
          <img src={logoUrl} alt="" className="h-6 w-auto" />
        ) : null}
        <span className="truncate">{tenantName}</span>
      </div>

      <div className="ml-auto flex items-center gap-1">
        <ThemeToggle />
        <UserMenu roles={roles} />
      </div>
    </header>
  )
}

export { Topbar }
