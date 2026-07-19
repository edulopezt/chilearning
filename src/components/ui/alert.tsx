import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const alertVariants = cva(
  "relative flex w-full gap-3 rounded-lg border px-4 py-3 text-sm [&>svg]:size-4 [&>svg]:shrink-0 [&>svg]:translate-y-0.5",
  {
    variants: {
      variant: {
        default: "border-border bg-card text-card-foreground",
        info: "border-ring/30 bg-accent text-accent-foreground",
        success: "border-success/30 bg-success/10 text-success",
        warning: "border-warning/30 bg-warning/10 text-warning",
        destructive: "border-destructive/30 bg-destructive/10 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

export interface AlertProps extends React.ComponentProps<"div">, VariantProps<typeof alertVariants> {
  /**
   * `"alert"` interrumpe al lector de pantalla de inmediato (errores);
   * `"status"` (default) anuncia sin interrumpir (confirmaciones/éxito).
   * Ver UX-STANDARDS.md §1 (estado Error vs. Success).
   */
  role?: "alert" | "status"
}

/**
 * Uso típico (icono + título/descripción envueltos aparte, el root es flex no grid):
 *   <Alert variant="destructive" role="alert">
 *     <CircleAlertIcon />
 *     <div className="flex flex-col gap-0.5">
 *       <AlertTitle>No pudimos guardar los cambios</AlertTitle>
 *       <AlertDescription>Intenta de nuevo en unos segundos.</AlertDescription>
 *     </div>
 *   </Alert>
 */
function Alert({ className, variant, role = "status", ...props }: AlertProps) {
  return (
    <div
      data-slot="alert"
      role={role}
      aria-live={role === "alert" ? "assertive" : "polite"}
      className={cn(alertVariants({ variant, className }))}
      {...props}
    />
  )
}

function AlertTitle({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div data-slot="alert-title" className={cn("font-medium tracking-tight", className)} {...props} />
  )
}

function AlertDescription({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="alert-description"
      className={cn("text-sm [&_p]:leading-relaxed", className)}
      {...props}
    />
  )
}

export { Alert, AlertTitle, AlertDescription, alertVariants }
