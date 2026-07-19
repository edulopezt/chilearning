"use client"

import { useEffect } from "react"
import { AlertTriangleIcon } from "lucide-react"

import { esCL } from "@/i18n/es-CL"
import { Button } from "@/components/ui/button"

export interface AreaErrorProps {
  error: Error & { digest?: string }
  reset: () => void
}

/**
 * Boundary de error por área (UX-STANDARDS.md §1/§4): mensaje amable +
 * botón "Reintentar" — nunca un stack trace ni el mensaje técnico crudo.
 */
function AreaError({ error, reset }: AreaErrorProps) {
  useEffect(() => {
    console.error(error)
  }, [error])

  return (
    <main className="flex min-h-[60vh] flex-col items-center justify-center gap-4 p-6 text-center">
      <AlertTriangleIcon className="size-10 text-muted-foreground" aria-hidden="true" />
      <div className="flex flex-col gap-1">
        <p className="font-medium">{esCL.shell.errorTitle}</p>
        <p className="max-w-sm text-sm text-muted-foreground">{esCL.shell.errorDescription}</p>
      </div>
      <Button onClick={reset}>{esCL.shell.errorRetry}</Button>
    </main>
  )
}

export { AreaError }
