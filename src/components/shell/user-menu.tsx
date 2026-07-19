"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { LogOutIcon, SettingsIcon, UserIcon } from "lucide-react"

import { esCL } from "@/i18n/es-CL"
import { createSupabaseBrowserClient } from "@/lib/supabase/client"
import { cn } from "@/lib/utils"
import type { RoleKey } from "@/modules/core/domain/rbac"
import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

export interface UserMenuProps {
  roles: readonly RoleKey[]
}

function UserMenu({ roles }: UserMenuProps) {
  const router = useRouter()

  async function onSignOut() {
    const supabase = createSupabaseBrowserClient()
    await supabase.auth.signOut()
    router.replace("/login")
    router.refresh()
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={esCL.shell.account}
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }), "rounded-full")}
      >
        <UserIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        <DropdownMenuLabel>{roles.join(", ") || esCL.shell.account}</DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem render={<Link href="/mis-datos" />}>
          <UserIcon className="size-4" />
          {esCL.dataRights.title}
        </DropdownMenuItem>
        <DropdownMenuItem render={<Link href="/preferencias" />}>
          <SettingsIcon className="size-4" />
          {esCL.shell.preferences}
        </DropdownMenuItem>
        <DropdownMenuSeparator />
        <DropdownMenuItem variant="destructive" onClick={onSignOut}>
          <LogOutIcon className="size-4" />
          {esCL.auth.signOut}
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { UserMenu }
