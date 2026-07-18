/**
 * Construcción del prompt del borrador de IA para staff (task 5.9, HU-9.5).
 * Dominio PURO, sin IO — mismo espíritu que `tutor-ia/domain/prompt.ts`
 * (`buildTutorPrompt`), pero para la AUDIENCIA opuesta: aquí quien lee el
 * resultado es el tutor/relator, no el alumno, y lo que sale es un BORRADOR
 * que un humano revisa y edita antes de enviar (RNF-10, human-in-the-loop).
 *
 * Minimización (RNF-10 + CA de HU-9.5, "sin datos identificatorios del
 * alumno"): la FIRMA de `DraftPromptInput` es una LISTA BLANCA — no tiene (y
 * nunca debe tener) nombre/RUN/correo/empresa del alumno. El llamador
 * (`draft-service.ts`) DEBE pasar `question` ya saneada por
 * `stripPIIForDraft` — este módulo no vuelve a sanear: confía en la puerta de
 * entrada, igual que `buildTutorPrompt` confía en `extractTutorContext`.
 */

export interface DraftPromptFragment {
  readonly n: number;
  readonly lessonId: string;
  readonly lessonTitle: string;
  readonly text: string;
}

export interface DraftPromptInput {
  readonly question: string;
  readonly fragments: readonly DraftPromptFragment[];
}

export interface DraftPromptMessage {
  readonly role: string;
  readonly content: string;
}

export interface DraftPromptResult {
  readonly system: string;
  readonly messages: DraftPromptMessage[];
}

function renderFragmentsBlock(fragments: readonly DraftPromptFragment[]): string {
  if (fragments.length === 0) {
    return "(No hay fragmentos de material disponibles para esta consulta.)";
  }
  return fragments.map((f) => `[${f.n}] (${f.lessonTitle})\n${f.text}`).join("\n\n");
}

/** Construye el prompt (system + messages) del borrador para staff, HU-9.5. */
export function buildDraftPrompt(input: DraftPromptInput): DraftPromptResult {
  const { question, fragments } = input;

  const system = [
    `Eres un asistente de inteligencia artificial de Chilearning que ayuda a un tutor o relator de una OTEC a redactar un borrador de respuesta breve y clara para la consulta de un alumno.`,
    `Responde SOLO con base en los fragmentos de material numerados que aparecen más abajo. Cada afirmación que hagas la citas con su número entre corchetes, por ejemplo [1] o [2].`,
    `Si los fragmentos no alcanzan para responder con confianza, dilo honestamente en el borrador en vez de inventar una respuesta, y sugiere derivar la consulta a un tutor humano de la OTEC.`,
    `Lo que produces es SOLO UN BORRADOR: el relator lo va a revisar, editar y recién después decidir si lo envía o no — nunca se envía solo. Redacta en un tono tentativo y profesional, en español de Chile, pensado para que el relator lo pueda ajustar con confianza antes de enviarlo.`,
    `Fragmentos de material disponibles:\n${renderFragmentsBlock(fragments)}`,
  ].join("\n\n");

  const messages: DraftPromptMessage[] = [{ role: "user", content: question }];

  return { system, messages };
}
