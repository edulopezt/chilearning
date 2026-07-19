"use client"

import * as React from "react"

type CharacterCountValue = string | number | readonly string[] | undefined

/**
 * Trackea la longitud del valor de un `<input>`/`<textarea>`, controlado o no,
 * para alimentar el contador de caracteres del design system (UX-STANDARDS.md
 * §5). Compartido por `Textarea` (src/components/ui/textarea.tsx) y
 * `FieldControl` (src/components/ui/field.tsx) para no duplicar la lógica.
 */
export function useCharacterCount(value: CharacterCountValue, defaultValue: CharacterCountValue) {
  const isControlled = value !== undefined
  const [uncontrolledLength, setUncontrolledLength] = React.useState(
    () => String(defaultValue ?? "").length
  )
  const length = isControlled ? String(value ?? "").length : uncontrolledLength

  const trackLength = React.useCallback(
    (nextValue: string) => {
      if (!isControlled) setUncontrolledLength(nextValue.length)
    },
    [isControlled]
  )

  return { length, trackLength }
}
