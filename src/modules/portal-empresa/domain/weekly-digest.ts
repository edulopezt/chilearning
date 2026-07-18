// ⚠ SIN `import "server-only"`: lo ejecuta el proceso WORKER (job
// `company-weekly-digest-tick`), fuera de Next. Import RELATIVO (el worker
// bundlea con esbuild y no resuelve el alias `@/` — mismo criterio que
// `certificados/domain/expiry.ts` y `comunicacion/reminders.ts`).
import { santiagoDate } from "../../reportes/domain/cumplimiento";

/**
 * Dominio puro del digest semanal de la empresa cliente (task 5.9, HU-8.2).
 * "Como RRHH, recibo un resumen periódico por correo (...), redactado con IA
 * en lenguaje ejecutivo (avance, riesgos, hitos) sobre datos agregados." CA:
 * "hacia el modelo solo van datos agregados/seudonimizados".
 *
 * Minimización (RNF-10 + CA literal): `DigestNarrativeInput` es una LISTA
 * BLANCA de 6 CONTEOS — mismo espíritu que `TutorPromptInput`/`DraftPromptInput`.
 * La firma NO TIENE (y nunca debe tener) `razonSocial` ni `companyId`: no es
 * que se omitan al llamar, es que el TIPO no admite colarlos por accidente.
 * `razonSocial` se usa SOLO en `renderCompanyDigestEmail` (saludo del correo,
 * texto determinístico), jamás en este prompt.
 */

export interface DigestNarrativeInput {
  readonly workers: number;
  readonly actions: number;
  readonly lessonsCompletedInPeriod: number;
  readonly attendanceDaysInPeriod: number;
  readonly gradesPublishedInPeriod: number;
  readonly certificatesIssuedInPeriod: number;
}

export interface DigestPromptMessage {
  readonly role: string;
  readonly content: string;
}

export interface DigestPromptResult {
  readonly system: string;
  readonly messages: DigestPromptMessage[];
}

/** Prompt del resumen ejecutivo semanal, HU-8.2. SOLO los 6 conteos entran. */
export function buildDigestNarrativePrompt(input: DigestNarrativeInput): DigestPromptResult {
  const {
    workers,
    actions,
    lessonsCompletedInPeriod,
    attendanceDaysInPeriod,
    gradesPublishedInPeriod,
    certificatesIssuedInPeriod,
  } = input;

  const system = [
    `Eres un asistente de inteligencia artificial de Chilearning que redacta, para el área de RRHH de una empresa cliente de una OTEC, un resumen semanal BREVE en lenguaje ejecutivo (avance, riesgos, hitos).`,
    `Trabajas SOLO con estos datos agregados de la semana — ningún nombre, RUN, correo ni dato de un trabajador en particular:`,
    `- Trabajadores vinculados a acciones de capacitación: ${workers}`,
    `- Acciones de capacitación en curso: ${actions}`,
    `- Lecciones completadas esta semana: ${lessonsCompletedInPeriod}`,
    `- Días con asistencia registrada esta semana: ${attendanceDaysInPeriod}`,
    `- Notas publicadas esta semana: ${gradesPublishedInPeriod}`,
    `- Certificados emitidos esta semana: ${certificatesIssuedInPeriod}`,
    `Redacta un párrafo breve (3 a 5 frases), en español de Chile, tono ejecutivo y profesional: destaca el avance, señala honestamente algún riesgo si los números lo sugieren (por ejemplo, pocas lecciones completadas o poca asistencia esta semana), y menciona hitos si corresponde (certificados emitidos). No inventes datos que no estén en esta lista.`,
  ].join("\n");

  const messages: DigestPromptMessage[] = [
    { role: "user", content: "Redacta el resumen semanal ejecutivo con los datos entregados." },
  ];

  return { system, messages };
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Lunes (America/Santiago) de la semana que contiene `dateIso`, como
 * `YYYY-MM-DD` — la clave del ledger `company_weekly_digest_log`. Se apoya en
 * `santiagoDate` (misma utilidad que el reporte oficial de cumplimiento) para
 * el día calendario correcto, y luego retrocede en UTC puro hasta el lunes
 * (el desplazamiento es aritmética de fecha, no depende de huso horario).
 */
export function weekStartOf(dateIso: string): string {
  const day = santiagoDate(Date.parse(dateIso));
  const dayMs = Date.parse(`${day}T00:00:00.000Z`);
  const dow = new Date(dayMs).getUTCDay(); // 0=domingo .. 6=sábado
  const daysSinceMonday = (dow + 6) % 7;
  return new Date(dayMs - daysSinceMonday * DAY_MS).toISOString().slice(0, 10);
}
