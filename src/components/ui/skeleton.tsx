import { cn } from "@/lib/utils"

/** Placeholder de carga fiel al layout real (UX-STANDARDS.md §1-2) — no un spinner genérico. */
function Skeleton({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="skeleton"
      className={cn("animate-pulse rounded-md bg-muted motion-reduce:animate-none", className)}
      {...props}
    />
  )
}

export { Skeleton }
