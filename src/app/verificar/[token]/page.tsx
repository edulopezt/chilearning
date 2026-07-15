import { esCL } from "@/i18n/es-CL";
import { verifyCertificate } from "@/modules/certificados/certificates-service";

export const dynamic = "force-dynamic";

const t = esCL.certificateVerify;

/**
 * Verificación PÚBLICA de certificado por token (task 3.2, HU-7.2). Ruta pública
 * (en PUBLIC_PATHS). Muestra validez + datos mínimos con RUN enmascarado (P4);
 * jamás el PDF ni el RUN completo. Usa el RPC `verify_certificate` (anon).
 */
export default async function VerificarPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;
  const cert = await verifyCertificate(token);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-lg flex-col justify-center gap-6 p-6">
      <h1 className="text-center text-xl font-bold tracking-tight">{t.title}</h1>

      {!cert ? (
        <div className="rounded-lg border border-red-300 bg-red-50 p-6 text-center dark:border-red-800 dark:bg-red-950">
          <p className="text-red-800 dark:text-red-200">{t.notFound}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          <div
            className={`rounded-lg border p-4 text-center font-semibold ${
              cert.status === "revoked"
                ? "border-red-300 bg-red-50 text-red-800 dark:border-red-800 dark:bg-red-950 dark:text-red-200"
                : "border-green-300 bg-green-50 text-green-800 dark:border-green-800 dark:bg-green-950 dark:text-green-200"
            }`}
          >
            {cert.status === "revoked" ? `✕ ${t.revokedStatus}` : `✓ ${t.valid}`}
          </div>

          <dl className="flex flex-col gap-2 rounded-lg border p-4 text-sm">
            <Row label={t.folio} value={cert.folio} />
            <Row label={t.student} value={cert.studentName} />
            <Row label={t.run} value={cert.runMasked} />
            <Row label={t.course} value={cert.courseName} />
            {cert.hours !== null ? <Row label={t.hours} value={String(cert.hours)} /> : null}
            {cert.startsOn && cert.endsOn ? <Row label={t.period} value={`${cert.startsOn} — ${cert.endsOn}`} /> : null}
            <Row label={t.otec} value={cert.otecName} />
            <Row label={t.issuedAt} value={new Date(cert.issuedAt).toLocaleDateString("es-CL")} />
            {cert.status === "revoked" && cert.revokedReason ? (
              <Row label={t.revokedReason} value={cert.revokedReason} />
            ) : null}
          </dl>

          <p className="text-center text-xs text-muted-foreground">{t.note}</p>
        </div>
      )}
    </main>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex justify-between gap-4 border-b pb-1 last:border-0">
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="text-right font-medium">{value}</dd>
    </div>
  );
}
