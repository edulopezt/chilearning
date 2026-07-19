import { redirect } from "next/navigation";

import { esCL } from "@/i18n/es-CL";
import { getInstructorBoard } from "@/modules/reportes/instructor-board";
import { getPrincipal } from "@/modules/core/auth/session";
import { authorize } from "@/modules/core/domain/rbac";
import type { SemaforoColor } from "@/modules/reportes/domain/semaforo";
import { EmptyState } from "@/components/ui/empty-state";
import { Progress } from "@/components/ui/progress";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";

export const dynamic = "force-dynamic";

const DOT: Record<SemaforoColor, string> = {
  green: "bg-success",
  yellow: "bg-warning",
  red: "bg-destructive",
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
        <p className="text-sm text-muted-foreground">{esCL.board.intro}</p>
      </header>

      {rows.length === 0 ? (
        <EmptyState title={esCL.board.empty} />
      ) : (
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{esCL.board.colStatus}</TableHead>
              <TableHead>{esCL.board.colCourse}</TableHead>
              <TableHead>{esCL.board.colCode}</TableHead>
              <TableHead>{esCL.board.colEnrolled}</TableHead>
              <TableHead>{esCL.board.colProgress}</TableHead>
              <TableHead>{esCL.board.colAttendance}</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {rows.map((r) => (
              <TableRow key={r.actionId}>
                <TableCell>
                  <span className="inline-flex items-center gap-2">
                    <span className={`inline-block size-3 rounded-full ${DOT[r.semaforo.color]}`} aria-hidden />
                    <span>{LABEL[r.semaforo.color]}</span>
                  </span>
                </TableCell>
                <TableCell>{r.courseName}</TableCell>
                <TableCell className="font-mono">{r.code}</TableCell>
                <TableCell>{r.enrolled}</TableCell>
                <TableCell>
                  <span className="flex items-center gap-2">
                    <Progress value={r.avgProgressPct} className="w-16" />
                    {r.avgProgressPct}%
                  </span>
                </TableCell>
                <TableCell>{r.attendanceRatePct}%</TableCell>
              </TableRow>
            ))}
          </TableBody>
        </Table>
      )}
    </main>
  );
}
