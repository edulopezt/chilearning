import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getInstructorBoard } from "@/modules/reportes/instructor-board";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import type { SemaforoColor } from "@/modules/reportes/domain/semaforo";

export const dynamic = "force-dynamic";

const DOT: Record<SemaforoColor, string> = {
  green: "bg-green-500",
  yellow: "bg-amber-500",
  red: "bg-red-500",
};
const LABEL: Record<SemaforoColor, string> = {
  green: esCL.board.green,
  yellow: esCL.board.yellow,
  red: esCL.board.red,
};

export default async function BoardPage() {
  const principal = await getPrincipal();
  if (!principal) redirect("/login");

  if (
    !principal.tenantId ||
    !authorize(principal, principal.tenantId, ["otec_admin", "coordinator", "instructor", "tutor"])
  ) {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-xl flex-col justify-center gap-4 p-6">
        <p className="text-muted-foreground">{esCL.board.forbidden}</p>
      </main>
    );
  }

  const rows = await getInstructorBoard(principal);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-3xl flex-col gap-6 p-4 sm:p-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-2xl font-bold tracking-tight">{esCL.board.title}</h1>
        <p className="text-muted-foreground text-sm">{esCL.board.intro}</p>
      </header>

      {rows.length === 0 ? (
        <p className="text-muted-foreground text-sm">{esCL.board.empty}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead>
              <tr className="border-b text-left">
                <th className="py-2 pr-3">{esCL.board.colStatus}</th>
                <th className="py-2 pr-3">{esCL.board.colCourse}</th>
                <th className="py-2 pr-3">{esCL.board.colCode}</th>
                <th className="py-2 pr-3">{esCL.board.colEnrolled}</th>
                <th className="py-2 pr-3">{esCL.board.colProgress}</th>
                <th className="py-2">{esCL.board.colAttendance}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.actionId} className="border-b last:border-0">
                  <td className="py-2 pr-3">
                    <span className="inline-flex items-center gap-2">
                      <span className={`inline-block size-3 rounded-full ${DOT[r.semaforo.color]}`} aria-hidden />
                      <span>{LABEL[r.semaforo.color]}</span>
                    </span>
                  </td>
                  <td className="py-2 pr-3">{r.courseName}</td>
                  <td className="py-2 pr-3 font-mono">{r.code}</td>
                  <td className="py-2 pr-3">{r.enrolled}</td>
                  <td className="py-2 pr-3">
                    <span className="flex items-center gap-2">
                      <span className="h-2 w-16 overflow-hidden rounded-full bg-neutral-200 dark:bg-neutral-700">
                        <span className="block h-full rounded-full bg-green-600" style={{ width: `${r.avgProgressPct}%` }} />
                      </span>
                      {r.avgProgressPct}%
                    </span>
                  </td>
                  <td className="py-2">{r.attendanceRatePct}%</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </main>
  );
}
