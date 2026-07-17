/**
 * Construcción del prompt del Tutor IA (task 5.8a, HU-11.3 — el archivo MÁS
 * importante de este PR). Dominio PURO, sin IO.
 *
 * Minimización estricta (RNF-10): al modelo SOLO van fragmentos de material +
 * avance agregado + conversación + nombre de pila. CERO RUN, apellidos,
 * correo, empresa, notas de terceros o datos SENCE. La defensa tiene dos capas:
 *
 *  1. `sanitizeFirstName`/`extractTutorContext` son la ÚNICA puerta desde datos
 *     "reales" del sistema hacia el prompt — filtran cualquier basura que
 *     venga en `fullName` (aunque el llamador la resuelva mal).
 *  2. La FIRMA de `TutorPromptInput` es una LISTA BLANCA de primitivas: no
 *     tiene (y nunca debe tener) un campo para apellido/correo/RUN/empresa del
 *     alumno. Un `Principal`/enrollment completo NUNCA se le pasa a
 *     `buildTutorPrompt` — eso es justamente lo que blinda el test estrella
 *     de `prompt.test.ts`.
 */

/** Caracteres de control Unicode (categoría Cc: tabs, saltos, nulos, DEL, …). */
const CONTROL_CHARS_RE = /\p{Cc}/gu;
/** Letras (con acentos/ñ vía \p{L}), apóstrofo y guion — todo lo demás (dígitos,
 *  puntuación, `@`, etc.) se descarta: un RUN, correo o "empresa" colados en
 *  `fullName` no sobreviven este filtro. */
const NON_NAME_CHARS_RE = /[^\p{L}'-]/gu;
const HAS_LETTER_RE = /\p{L}/u;
const MAX_FIRST_NAME_CHARS = 40;
const FALLBACK_FIRST_NAME = "Alumno/a";

/** Primer token de un nombre completo, saneado: sin dígitos, sin caracteres de
 *  control, sin puntuación; capado a 40 chars; `"Alumno/a"` si queda vacío. */
export function sanitizeFirstName(fullName: string): string {
  const noControl = fullName.replace(CONTROL_CHARS_RE, " ");
  const firstToken = noControl.trim().split(/\s+/)[0] ?? "";
  const cleaned = firstToken.replace(NON_NAME_CHARS_RE, "").slice(0, MAX_FIRST_NAME_CHARS);
  return HAS_LETTER_RE.test(cleaned) ? cleaned : FALLBACK_FIRST_NAME;
}

/**
 * Única puerta de entrada permitida desde datos "reales" del sistema (un
 * `Principal` autenticado + el nombre completo YA RESUELTO por el llamador)
 * hacia el prompt. No toca IO ni busca nada en la BD — el llamador (server
 * action / endpoint) es quien resuelve `fullName` desde `enrollments` y se lo
 * pasa ya listo.
 */
export function extractTutorContext(
  principal: { readonly userId: string; readonly roles: readonly string[] },
  fullName: string,
): { readonly firstName: string } {
  void principal; // reservado (hoy no cambia el saneo; documenta el contrato de la puerta)
  return { firstName: sanitizeFirstName(fullName) };
}

export interface TutorPromptFragment {
  readonly n: number;
  readonly lessonId: string;
  readonly lessonTitle: string;
  readonly text: string;
}

export interface TutorPromptHistoryEntry {
  readonly role: "user" | "assistant";
  readonly content: string;
}

export interface TutorPromptInput {
  readonly courseName: string;
  readonly firstName: string;
  readonly fragments: readonly TutorPromptFragment[];
  readonly aggregateProgress: { readonly completed: number; readonly total: number };
  readonly history: readonly TutorPromptHistoryEntry[];
  readonly question: string;
}

export interface TutorPromptMessage {
  readonly role: string;
  readonly content: string;
}

export interface TutorPromptResult {
  readonly system: string;
  readonly messages: TutorPromptMessage[];
}

function renderFragmentsBlock(fragments: readonly TutorPromptFragment[]): string {
  if (fragments.length === 0) {
    return "(No hay fragmentos de material disponibles para esta pregunta.)";
  }
  return fragments.map((f) => `[${f.n}] (${f.lessonTitle})\n${f.text}`).join("\n\n");
}

/** Construye el prompt (system + messages) en español chileno, HU-11.3. */
export function buildTutorPrompt(input: TutorPromptInput): TutorPromptResult {
  const { courseName, firstName, fragments, aggregateProgress, history, question } = input;

  const system = [
    `Soy un asistente de inteligencia artificial de Chilearning para el curso "${courseName}". ¡Hola, ${firstName}!`,
    `Respondo SOLO con base en los fragmentos de material numerados que aparecen más abajo. Cada afirmación que haga la cito con su número entre corchetes, por ejemplo [1] o [2].`,
    `Si la respuesta no está en el material entregado, lo digo honestamente en vez de inventar una respuesta, y sugiero derivar la consulta a un tutor humano de la OTEC.`,
    `Avance del alumno en el curso: ${aggregateProgress.completed} de ${aggregateProgress.total} lecciones completadas.`,
    `Fragmentos de material disponibles:\n${renderFragmentsBlock(fragments)}`,
  ].join("\n\n");

  const messages: TutorPromptMessage[] = [
    ...history.map((h) => ({ role: h.role, content: h.content })),
    { role: "user", content: question },
  ];

  return { system, messages };
}

/**
 * Parsea ocurrencias `[n]` en el texto de una respuesta y las mapea a
 * `fragments[n-1]`. Ignora citas fuera de rango; deduplica por `lessonId`
 * (una lección citada varias veces aparece una sola vez).
 */
export function mapCitations(
  answerText: string,
  fragments: readonly TutorPromptFragment[],
): { readonly lessonId: string; readonly lessonTitle: string }[] {
  const seen = new Set<string>();
  const out: { lessonId: string; lessonTitle: string }[] = [];
  const re = /\[(\d+)\]/g;
  let match: RegExpExecArray | null;
  while ((match = re.exec(answerText)) !== null) {
    const n = Number(match[1]);
    const frag = fragments[n - 1];
    if (!frag) continue;
    if (seen.has(frag.lessonId)) continue;
    seen.add(frag.lessonId);
    out.push({ lessonId: frag.lessonId, lessonTitle: frag.lessonTitle });
  }
  return out;
}
