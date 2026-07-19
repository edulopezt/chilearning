"use client"

import { MonitorIcon, MoonIcon, SunIcon } from "lucide-react"

import { esCL } from "@/i18n/es-CL"
import { cn } from "@/lib/utils"
import { buttonVariants } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu"

import { useTheme, type Theme } from "./theme-provider"

const t = esCL.shell

const OPTIONS: ReadonlyArray<{ value: Theme; label: string; icon: typeof SunIcon }> = [
  { value: "light", label: t.themeLight, icon: SunIcon },
  { value: "dark", label: t.themeDark, icon: MoonIcon },
  { value: "system", label: t.themeSystem, icon: MonitorIcon },
]

/** Selector de tema claro/oscuro/sistema — vive en la topbar del shell y en `/preferencias`. */
function ThemeToggle() {
  const { theme, resolvedTheme, setTheme } = useTheme()
  const CurrentIcon = resolvedTheme === "dark" ? MoonIcon : SunIcon

  return (
    <DropdownMenu>
      <DropdownMenuTrigger
        aria-label={t.theme}
        className={cn(buttonVariants({ variant: "ghost", size: "icon" }))}
      >
        <CurrentIcon className="size-4" />
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end">
        {OPTIONS.map((opt) => (
          <DropdownMenuItem key={opt.value} onClick={() => setTheme(opt.value)}>
            <opt.icon className="size-4" />
            {opt.label}
            {theme === opt.value ? <span className="ml-auto text-xs text-muted-foreground">✓</span> : null}
          </DropdownMenuItem>
        ))}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

export { ThemeToggle }
