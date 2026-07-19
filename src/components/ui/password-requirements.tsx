import { CheckIcon, XIcon } from "lucide-react"

import { cn } from "@/lib/utils"

export interface PasswordRequirement {
  id: string
  label: string
  met: boolean
}

export interface PasswordRequirementsProps extends React.ComponentProps<"ul"> {
  requirements: PasswordRequirement[]
}

/**
 * Checklist en vivo de requisitos de contraseña (UX-STANDARDS.md §5): cada
 * requisito se marca al cumplirse en tiempo real — nunca una regla oculta que
 * solo se revela al fallar el submit. Calcular `met` por requisito es
 * responsabilidad del formulario que la usa, contra su propia política.
 */
function PasswordRequirements({ requirements, className, ...props }: PasswordRequirementsProps) {
  return (
    <ul className={cn("flex flex-col gap-1", className)} {...props}>
      {requirements.map((req) => (
        <li
          key={req.id}
          className={cn(
            "flex items-center gap-1.5 text-sm transition-colors",
            req.met ? "text-success" : "text-muted-foreground"
          )}
        >
          {req.met ? (
            <CheckIcon className="size-3.5 shrink-0" aria-hidden="true" />
          ) : (
            <XIcon className="size-3.5 shrink-0" aria-hidden="true" />
          )}
          <span>{req.label}</span>
          <span className="sr-only">{req.met ? " (cumplido)" : " (pendiente)"}</span>
        </li>
      ))}
    </ul>
  )
}

export { PasswordRequirements }
