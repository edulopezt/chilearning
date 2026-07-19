"use client"

import * as React from "react"

import { THEME_STORAGE_KEY } from "./theme-script"

export type Theme = "light" | "dark" | "system"
export type ResolvedTheme = "light" | "dark"

interface ThemeContextValue {
  theme: Theme
  resolvedTheme: ResolvedTheme
  setTheme: (theme: Theme) => void
}

const ThemeContext = React.createContext<ThemeContextValue | null>(null)

// `localStorage.setItem` no dispara `storage` en la MISMA pestaña que escribió
// (solo en las demás) — este evento propio cierra ese hueco para que `setTheme`
// se refleje de inmediato en la pestaña actual.
const THEME_CHANGE_EVENT = "chilearning-theme-change"

function readStoredTheme(): Theme {
  const stored = localStorage.getItem(THEME_STORAGE_KEY)
  return stored === "light" || stored === "dark" || stored === "system" ? stored : "system"
}

function subscribeToStoredTheme(onChange: () => void): () => void {
  window.addEventListener("storage", onChange)
  window.addEventListener(THEME_CHANGE_EVENT, onChange)
  return () => {
    window.removeEventListener("storage", onChange)
    window.removeEventListener(THEME_CHANGE_EVENT, onChange)
  }
}

function readSystemTheme(): ResolvedTheme {
  return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
}

function subscribeToSystemTheme(onChange: () => void): () => void {
  const mql = window.matchMedia("(prefers-color-scheme: dark)")
  mql.addEventListener("change", onChange)
  return () => mql.removeEventListener("change", onChange)
}

function applyThemeToDom(resolved: ResolvedTheme): void {
  const root = document.documentElement
  root.classList.toggle("dark", resolved === "dark")
  root.style.colorScheme = resolved
}

const SERVER_THEME: Theme = "system"
const SERVER_RESOLVED_THEME: ResolvedTheme = "light"

/**
 * Contexto de tema (dark mode completo). El anti-FOUC real lo hace
 * `<ThemeScript>` en `<head>` (corre antes de que este provider hidrate).
 * Lee el mismo localStorage/`matchMedia` vía `useSyncExternalStore` (con
 * snapshot de servidor fijo, para que el primer render de cliente coincida
 * con el SSR sin parpadeo) y aplica los cambios al DOM en un efecto que solo
 * muta el DOM — nunca llama `setState`, así que no cae en la regla de React
 * que desaconseja actualizar estado de forma síncrona dentro de un efecto.
 */
function ThemeProvider({ children }: { children: React.ReactNode }) {
  const theme = React.useSyncExternalStore(subscribeToStoredTheme, readStoredTheme, () => SERVER_THEME)
  const systemTheme = React.useSyncExternalStore(subscribeToSystemTheme, readSystemTheme, () => SERVER_RESOLVED_THEME)
  const resolvedTheme: ResolvedTheme = theme === "system" ? systemTheme : theme

  React.useEffect(() => {
    applyThemeToDom(resolvedTheme)
  }, [resolvedTheme])

  const setTheme = React.useCallback((next: Theme) => {
    localStorage.setItem(THEME_STORAGE_KEY, next)
    window.dispatchEvent(new Event(THEME_CHANGE_EVENT))
  }, [])

  const value = React.useMemo(() => ({ theme, resolvedTheme, setTheme }), [theme, resolvedTheme, setTheme])

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

function useTheme(): ThemeContextValue {
  const ctx = React.useContext(ThemeContext)
  if (!ctx) throw new Error("useTheme debe usarse dentro de <ThemeProvider>")
  return ctx
}

export { ThemeProvider, useTheme }
