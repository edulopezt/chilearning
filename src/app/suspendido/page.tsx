import { esCL } from "@/i18n/es-CL";

/**
 * Aviso público de OTEC suspendida (task 5.3, HU-1.4). Página ESTÁTICA y sin
 * sesión: el middleware reescribe aquí TODO el subdominio de un tenant
 * suspendido. Los datos quedan intactos; la reactivación es 1 clic.
 */
export default function SuspendedPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-2xl font-bold tracking-tight">{esCL.suspended.title}</h1>
      <p className="text-muted-foreground">{esCL.suspended.message}</p>
      <p className="text-muted-foreground text-sm">{esCL.suspended.contact}</p>
    </main>
  );
}
