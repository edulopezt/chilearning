"use client"

import Link from "next/link"
import { usePathname } from "next/navigation"

import { esCL } from "@/i18n/es-CL"
import { cn } from "@/lib/utils"
import type { RoleKey } from "@/modules/core/domain/rbac"

import { navForRoles, type NavItem } from "./nav-config"

export interface SidebarProps {
  roles: readonly RoleKey[]
  className?: string
}

function isWithin(pathname: string, href: string): boolean {
  return pathname === href || pathname.startsWith(`${href}/`)
}

/**
 * Nav del área activa según la URL (o la lista de áreas si no hay una
 * específica — home, mis-datos, preferencias). Calcula `navForRoles`
 * localmente (no recibe `areas` por prop): los íconos son referencias a
 * componentes y pasarlas de un Server Component a este Client Component
 * rompería la serialización de RSC — ver app-shell.tsx.
 */
function Sidebar({ roles, className }: SidebarProps) {
  const pathname = usePathname()
  const areas = navForRoles({ roles })
  const activeArea = areas.find((area) => area.items.some((item) => isWithin(pathname, item.href)) || isWithin(pathname, area.href));
  const items: NavItem[] =
    activeArea && activeArea.items.length > 0
      ? activeArea.items
      : areas.map((area) => ({ href: area.href, label: area.label, icon: area.icon }));

  return (
    <nav aria-label={esCL.shell.mainNav} className={cn("flex flex-col gap-1 p-3", className)}>
      {items.map((item) => {
        const current = isWithin(pathname, item.href);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={cn(
              "flex h-11 items-center gap-3 rounded-md px-3 text-sm font-medium transition-colors",
              current
                ? "bg-sidebar-accent text-sidebar-accent-foreground"
                : "text-sidebar-foreground/80 hover:bg-sidebar-accent hover:text-sidebar-accent-foreground"
            )}
          >
            <Icon className="size-4 shrink-0" />
            <span className="truncate">{item.label}</span>
          </Link>
        );
      })}
    </nav>
  );
}

export { Sidebar }
