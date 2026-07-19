import {
  AwardIcon,
  BotIcon,
  BuildingIcon,
  ClipboardCheckIcon,
  ClipboardListIcon,
  DownloadIcon,
  FileTextIcon,
  GraduationCapIcon,
  LayoutDashboardIcon,
  MailIcon,
  MessageSquareIcon,
  NotebookTabsIcon,
  PaletteIcon,
  ServerIcon,
  ShieldCheckIcon,
  UserCogIcon,
  UsersIcon,
  type LucideIcon,
} from "lucide-react"

import { esCL } from "@/i18n/es-CL"
import { hasAnyRole, hasRole, isSuperadmin, type Principal } from "@/modules/core/domain/rbac"

export interface NavItem {
  href: string
  label: string
  icon: LucideIcon
}

export interface NavArea {
  key: string
  label: string
  icon: LucideIcon
  href: string
  /** Items del sidebar cuando se está DENTRO de esta área. Vacío = área de una sola página. */
  items: NavItem[]
}

/**
 * Única fuente de la navegación del shell (task 6.7) — dominio puro, sin IO:
 * dado el rol del usuario, qué áreas puede alcanzar y qué ve en el sidebar de
 * cada una. La usan tanto el sidebar (filtra por el área activa según la URL)
 * como el home de `/dashboard` (una tarjeta por área).
 *
 * Deliberadamente conservador con los ítems nuevos que no estaban en el
 * dashboard plano anterior (certificados/vencimientos, mensajes, empresas,
 * supervisores, derechos, exportación): solo otec_admin, igual que sence/
 * marca/correos — coordinator solo ve cursos/acciones/inscripciones/tutor-ia,
 * el mismo recorte que ya existía (revisión de spec-compliance 2026-07-18).
 * Esto es navegación, no el límite de seguridad real (cada página autoriza
 * por su cuenta) — un ítem de más solo sería un enlace muerto, no una fuga.
 */
export function navForRoles(principal: Pick<Principal, "roles">): NavArea[] {
  const areas: NavArea[] = []
  const t = esCL

  if (hasRole(principal, "student")) {
    areas.push({
      key: "mi-curso",
      label: t.dashboard.goToCourse,
      icon: GraduationCapIcon,
      href: "/mi-curso",
      items: [],
    })
  }

  if (hasAnyRole(principal, ["otec_admin", "coordinator"])) {
    const items: NavItem[] = [
      { href: "/admin/cursos", label: t.courses.title, icon: ClipboardListIcon },
      { href: "/admin/acciones", label: t.actions.title, icon: ClipboardListIcon },
      { href: "/admin/inscripciones", label: t.enrollmentImport.title, icon: UsersIcon },
      { href: "/admin/tutor-ia", label: t.tutorIA.adminTitle, icon: BotIcon },
    ]
    if (hasRole(principal, "otec_admin")) {
      items.push(
        { href: "/admin/sence", label: t.senceAdmin.title, icon: ShieldCheckIcon },
        { href: "/admin/marca", label: t.branding.title, icon: PaletteIcon },
        { href: "/admin/correos", label: t.emails.title, icon: MailIcon },
        { href: "/admin/certificados/vencimientos", label: t.certExpiry.title, icon: AwardIcon },
        { href: "/admin/mensajes", label: t.communication.inboxTitle, icon: MessageSquareIcon },
        { href: "/admin/empresas", label: t.companies.title, icon: BuildingIcon },
        { href: "/admin/supervisores", label: t.supervisorGrants.title, icon: UserCogIcon },
        { href: "/admin/derechos", label: t.dsrAdmin.title, icon: FileTextIcon },
        { href: "/admin/exportacion", label: t.tenantExport.title, icon: DownloadIcon },
      )
    }
    areas.push({ key: "admin", label: t.shell.adminArea, icon: ClipboardListIcon, href: "/admin/cursos", items })
  }

  if (hasAnyRole(principal, ["otec_admin", "coordinator", "instructor", "tutor"])) {
    areas.push({
      key: "tablero",
      label: t.board.title,
      icon: LayoutDashboardIcon,
      href: "/tablero",
      items: [
        { href: "/tablero", label: t.board.title, icon: LayoutDashboardIcon },
        { href: "/tablero/entregas", label: t.grading.title, icon: ClipboardCheckIcon },
        { href: "/tablero/notas", label: t.gradebook.title, icon: NotebookTabsIcon },
      ],
    })
  }

  if (hasRole(principal, "supervisor")) {
    areas.push({
      key: "supervisor",
      label: t.supervisorPortal.dashboardLink,
      icon: ShieldCheckIcon,
      href: "/supervisor",
      items: [],
    })
  }

  if (hasRole(principal, "company")) {
    areas.push({
      key: "empresa",
      label: t.companyPortal.title,
      icon: BuildingIcon,
      href: "/empresa",
      items: [],
    })
  }

  if (isSuperadmin(principal)) {
    areas.push({
      key: "superadmin",
      label: t.superadmin.title,
      icon: ServerIcon,
      href: "/superadmin",
      items: [
        { href: "/superadmin", label: t.superadmin.title, icon: ServerIcon },
        { href: "/superadmin/tenants", label: t.superadmin.tenantsHeading, icon: BuildingIcon },
      ],
    })
  }

  return areas
}
