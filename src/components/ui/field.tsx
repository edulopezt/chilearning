"use client"

import { Field as FieldPrimitive } from "@base-ui/react/field"

import { cn } from "@/lib/utils"
import { useCharacterCount } from "@/components/ui/use-character-count"

/**
 * Composición de campo de formulario (label + control + hint + error) sobre
 * `@base-ui/react/field`: asocia label/control/error por accesibilidad (id,
 * aria-describedby, aria-invalid) automáticamente.
 *
 * La validación es EXTERNA (Zod en el server action, no ValidityState nativo del
 * navegador) — por eso `FieldRoot` recibe `invalid` como prop controlada por el
 * caller, y `FieldError` siempre hace `match`: el caller decide si lo monta
 * (`{error ? <FieldError>{error}</FieldError> : null}`). El timing de cuándo
 * revalidar (on-blur, luego on-change tras el primer error) es responsabilidad
 * del formulario que usa este primitivo — ver UX-STANDARDS.md §5.
 *
 * Uso típico:
 *   <FieldRoot invalid={!!error}>
 *     <FieldLabel>Nombre</FieldLabel>
 *     <FieldControl placeholder="Ej. María Pérez" />
 *     <FieldDescription>Como aparecerá en tu certificado.</FieldDescription>
 *     {error ? <FieldError>{error}</FieldError> : null}
 *   </FieldRoot>
 *
 * Para un textarea: <FieldControl render={<Textarea />} />
 */
function FieldRoot({ className, ...props }: FieldPrimitive.Root.Props) {
  return (
    <FieldPrimitive.Root data-slot="field" className={cn("flex flex-col gap-1.5", className)} {...props} />
  )
}

function FieldLabel({ className, ...props }: FieldPrimitive.Label.Props) {
  return (
    <FieldPrimitive.Label
      data-slot="field-label"
      className={cn("text-sm leading-none font-medium select-none", className)}
      {...props}
    />
  )
}

function FieldDescription({ className, ...props }: FieldPrimitive.Description.Props) {
  return (
    <FieldPrimitive.Description
      data-slot="field-description"
      className={cn("text-sm text-muted-foreground", className)}
      {...props}
    />
  )
}

function FieldError({ className, ...props }: Omit<FieldPrimitive.Error.Props, "match">) {
  return (
    <FieldPrimitive.Error
      data-slot="field-error"
      match
      role="alert"
      className={cn("text-sm font-medium text-destructive", className)}
      {...props}
    />
  )
}

export interface FieldControlProps extends FieldPrimitive.Control.Props {
  /** Muestra el contador de caracteres (UX-STANDARDS.md §5). Default: `true` si hay `maxLength`.
   *  Solo aplica al `<input>` nativo por defecto — sin efecto si se pasa `render` (ej. `render={<Textarea />}`, que ya trae su propio contador). */
  showCount?: boolean
}

function FieldControl({
  className,
  maxLength,
  showCount,
  value,
  defaultValue,
  onChange,
  render,
  ...props
}: FieldControlProps) {
  const hasCustomRender = render !== undefined
  const { length, trackLength } = useCharacterCount(value, defaultValue)
  const shouldShowCount = !hasCustomRender && (showCount ?? maxLength != null) && maxLength != null

  const control = (
    <FieldPrimitive.Control
      data-slot="field-control"
      render={render}
      maxLength={maxLength}
      value={value}
      defaultValue={defaultValue}
      onChange={
        hasCustomRender
          ? onChange
          : (event) => {
              trackLength(event.target.value)
              onChange?.(event)
            }
      }
      className={cn(
        "flex h-11 w-full min-w-0 rounded-md border border-input bg-transparent px-3 py-2 text-base shadow-xs transition-colors outline-none",
        "placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50",
        "data-[invalid]:border-destructive data-[invalid]:ring-3 data-[invalid]:ring-destructive/20 dark:data-[invalid]:ring-destructive/40",
        "disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50",
        "md:text-sm",
        shouldShowCount && "pb-6",
        className
      )}
      {...props}
    />
  )

  if (!shouldShowCount) return control

  return (
    <div className="relative">
      {control}
      <span
        className="pointer-events-none absolute right-2 bottom-1.5 text-xs text-muted-foreground tabular-nums"
        aria-hidden="true"
      >
        {length}/{maxLength}
      </span>
    </div>
  )
}

export { FieldRoot, FieldLabel, FieldDescription, FieldError, FieldControl }
