"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

export interface TextareaProps extends React.ComponentProps<"textarea"> {
  /** Muestra el contador de caracteres (UX-STANDARDS.md §5). Default: `true` si hay `maxLength`. */
  showCount?: boolean
}

/** Textarea suelto (fuera de `Field`), con contador de caracteres opcional. */
function Textarea({
  className,
  maxLength,
  showCount,
  value,
  defaultValue,
  onChange,
  ...props
}: TextareaProps) {
  const isControlled = value !== undefined
  const [uncontrolledLength, setUncontrolledLength] = React.useState(
    () => String(defaultValue ?? "").length
  )
  const length = isControlled ? String(value ?? "").length : uncontrolledLength
  const shouldShowCount = (showCount ?? maxLength != null) && maxLength != null

  return (
    <div className="relative">
      <textarea
        data-slot="textarea"
        maxLength={maxLength}
        value={value}
        defaultValue={defaultValue}
        onChange={(event) => {
          if (!isControlled) setUncontrolledLength(event.target.value.length)
          onChange?.(event)
        }}
        className={cn(
          "flex field-sizing-content min-h-20 w-full rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-colors outline-none",
          "placeholder:text-muted-foreground",
          "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
          "aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40",
          "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
          "md:text-sm",
          shouldShowCount && "pb-6",
          className
        )}
        {...props}
      />
      {shouldShowCount ? (
        <span
          className="pointer-events-none absolute right-2 bottom-1.5 text-xs text-muted-foreground tabular-nums"
          aria-hidden="true"
        >
          {length}/{maxLength}
        </span>
      ) : null}
    </div>
  )
}

export { Textarea }
