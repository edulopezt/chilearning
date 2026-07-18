import Link from "next/link";
import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getPrincipal } from "@/modules/core/auth/session";
import { resolveTutorContext } from "@/modules/tutor-ia/tutor-chat-service";
import { TutorChat } from "./tutor-chat";

export const dynamic = "force-dynamic";

/** Chat del Tutor IA (task 5.8b, HU-11.1). Server Component: resuelve el
 *  gate de acceso y delega el streaming al client component. */
export default async function TutorPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  const gate = await resolveTutorContext(principal);
  if (!gate.ok) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col justify-center gap-4 p-6 text-center">
        <p className="text-muted-foreground">{esCL.tutorIA.unavailable[gate.reason]}</p>
        <Link href="/mi-curso" className="text-sm font-medium underline">
          {esCL.tutorIA.backToCourse}
        </Link>
      </main>
    );
  }

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col gap-4 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{esCL.tutorIA.title}</h1>
        <Link href="/mi-curso" className="text-sm underline">
          {esCL.tutorIA.backToCourse}
        </Link>
      </header>
      <TutorChat courseName={gate.context.courseName} />
    </main>
  );
}
