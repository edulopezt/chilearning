"use client"

import * as React from "react"

/**
 * Devuelve `true` solo si `active` lleva `delayMs` (default 400ms) en `true` de
 * forma continua. Gatea el montaje de loaders (Spinner/Skeleton/Progress) para
 * que una acción que dura menos de eso nunca alcance a mostrarlos — un loader
 * así hace que la app se SIENTA más lenta, no más rápida (UX-STANDARDS.md §3).
 */
export function useDelayedValue(active: boolean, delayMs = 400): boolean {
  const [shown, setShown] = React.useState(false)

  React.useEffect(() => {
    if (!active) return

    const timer = setTimeout(() => setShown(true), delayMs)
    return () => {
      clearTimeout(timer)
      setShown(false)
    }
  }, [active, delayMs])

  return active && shown
}
