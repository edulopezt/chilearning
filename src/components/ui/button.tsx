"use client"

import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

import { buttonVariants } from "./button-variants"
import { Spinner } from "./spinner"
import { useDelayedValue } from "./use-delayed-value"

export interface ButtonProps extends ButtonPrimitive.Props, VariantProps<typeof buttonVariants> {
  /**
   * Muestra un spinner inline y deshabilita el botón mientras dura la acción.
   * El spinner se gatea a ~400ms continuos (UX-STANDARDS.md §3): una acción
   * que termina antes nunca alcanza a pintarlo.
   */
  loading?: boolean
}

function Button({
  className,
  variant = "default",
  size = "default",
  loading = false,
  disabled,
  children,
  ...props
}: ButtonProps) {
  const showSpinner = useDelayedValue(loading)
  return (
    <ButtonPrimitive
      data-slot="button"
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    >
      {showSpinner ? <Spinner size="sm" aria-hidden="true" className="mr-0.5" /> : null}
      {children}
    </ButtonPrimitive>
  )
}

export { Button }
