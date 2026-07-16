/**
 * Snapshot §7-R7 del certificado (task 3.2, HU-7.1). Se CONGELA en la emisión
 * (D-112): el PDF es función determinista del snapshot → regenerable, y un
 * certificado ya emitido nunca cambia aunque cambien los datos vivos. Sin IO.
 *
 * ⚠ §7-R7 abierto en el spec: esta lista de campos es el DEFAULT propuesto,
 * pendiente de confirmación de Edu contra la guía de apoyo OTEC antes de emitir
 * certificados reales en producción.
 */

import { maskRun } from "./folio";

export interface CertificateSnapshot {
  readonly studentName: string;
  readonly run: string;
  readonly runMasked: string;
  readonly courseName: string;
  readonly hours: number;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly finalGrade: number | null;
  /** CodSence del curso (10 dígitos; null en línea 1). */
  readonly codSence: string | null;
  /** Código de la acción. */
  readonly actionCode: string;
  readonly attendancePct: number;
  readonly otecName: string;
  readonly otecRut: string | null;
  readonly brandPrimary: string;
  readonly brandAccent: string;
  readonly logoUrl: string | null;
  readonly isSence: boolean;
  readonly issuedAtISO: string;
}

export interface SnapshotInputs {
  readonly studentName: string;
  readonly run: string;
  readonly courseName: string;
  readonly hours: number;
  readonly startsOn: string | null;
  readonly endsOn: string | null;
  readonly finalGrade: number | null;
  readonly codSence: string | null;
  readonly actionCode: string;
  readonly attendancePct: number;
  readonly otecName: string;
  readonly otecRut: string | null;
  readonly brandPrimary: string;
  readonly brandAccent: string;
  readonly logoUrl: string | null;
  readonly isSence: boolean;
  readonly issuedAtISO: string;
}

export function buildCertificateSnapshot(inputs: SnapshotInputs): CertificateSnapshot {
  return {
    studentName: inputs.studentName,
    run: inputs.run,
    runMasked: maskRun(inputs.run),
    courseName: inputs.courseName,
    hours: inputs.hours,
    startsOn: inputs.startsOn,
    endsOn: inputs.endsOn,
    finalGrade: inputs.finalGrade,
    codSence: inputs.codSence,
    actionCode: inputs.actionCode,
    attendancePct: inputs.attendancePct,
    otecName: inputs.otecName,
    otecRut: inputs.otecRut,
    brandPrimary: inputs.brandPrimary,
    brandAccent: inputs.brandAccent,
    logoUrl: inputs.logoUrl,
    isSence: inputs.isSence,
    issuedAtISO: inputs.issuedAtISO,
  };
}
