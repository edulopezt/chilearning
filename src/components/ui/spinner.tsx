import { Loader2Icon } from "lucide-react"

import { cn } from "@/lib/utils"

export interface SpinnerProps extends React.ComponentProps<"svg"> {
  size?: "sm" | "default" | "lg"
}

const SIZES = {
  sm: "size-4",
  default: "size-5",
  lg: "size-6",
} as const

/**
 * Spinner inline (UX-STANDARDS.md §2: acciones pequeñas, no páginas completas —
 * para eso usar `Skeleton`). No decide POR SÍ SOLO cuándo mostrarse: el caller
 * gatea el montaje con `useDelayedValue` para que una acción rápida (<1s) nunca
 * alcance a pintarlo.
 */
function Spinner({ className, size = "default", "aria-label": ariaLabel = "Cargando", ...props }: SpinnerProps) {
  return (
    <Loader2Icon
      role="status"
      aria-label={ariaLabel}
      className={cn("animate-spin motion-reduce:animate-none", SIZES[size], className)}
      {...props}
    />
  )
}

export { Spinner }
