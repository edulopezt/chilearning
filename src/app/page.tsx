import { esCL } from "@/i18n/es-CL";

export default function Home() {
  return (
    <main className="flex min-h-dvh flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-4xl font-bold tracking-tight">{esCL.landing.title}</h1>
      <p className="text-muted-foreground max-w-md text-lg">{esCL.landing.tagline}</p>
      <p className="text-muted-foreground text-sm">{esCL.landing.status}</p>
    </main>
  );
}
