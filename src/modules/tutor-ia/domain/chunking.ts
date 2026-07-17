/**
 * Chunking de lecciones para el retrieval del Tutor IA (task 5.8a, HU-11.1,
 * ADR-007). Dominio PURO, sin IO — lo consume tanto el hook síncrono de
 * publicación (`src/modules/academico/lesson-service.ts`) como el worker
 * (`tutor-maintenance.ts`), así que NO lleva `import "server-only"`.
 *
 * Estrategia: corta en límites de párrafo/heading (markdown simple: doble
 * salto de línea, o antes de un `#`..`######`) antes que a mitad de palabra.
 * Un párrafo/segmento gigante sin saltos se sub-parte igual (nunca crashea,
 * nunca produce un chunk descomunal). Cada chunk queda prefijado con el
 * título de la lección: aislado, sin el chunk pierde contexto ("¿de qué
 * lección es esto?") cuando el retrieval lo trae suelto.
 */

export interface ChunkLessonOptions {
  /** Tamaño objetivo (soft) de cada chunk, en caracteres, ANTES del prefijo de título. */
  readonly targetChars?: number;
  /** Cuánto texto del final del chunk anterior se repite al inicio del siguiente. */
  readonly overlapChars?: number;
}

export interface LessonChunk {
  readonly chunkIndex: number;
  readonly text: string;
}

const DEFAULT_TARGET_CHARS = 1200;
const DEFAULT_OVERLAP_CHARS = 200;

/**
 * Corta un texto que no cabe en `max` en piezas <= `max`, buscando el último
 * espacio en blanco antes del límite; si no hay ninguno (una "palabra" gigante
 * sin espacios), corta duro en `max`. Nunca lanza, nunca deja un resto sin usar.
 */
function hardSplit(text: string, max: number): string[] {
  if (max <= 0) return [text];
  if (text.length <= max) return [text];
  const pieces: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let cut = rest.lastIndexOf(" ", max);
    if (cut <= 0) cut = max; // sin espacio útil dentro del límite: corte duro
    pieces.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  if (rest.length > 0) pieces.push(rest);
  return pieces.filter((p) => p.length > 0);
}

/** Segmenta por párrafos (doble salto de línea) y antes de headings markdown. */
function splitSegments(content: string): string[] {
  return content
    .split(/\n(?=#{1,6}\s)|\n{2,}/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

export function chunkLessonContent(
  title: string,
  content: string,
  opts: ChunkLessonOptions = {},
): LessonChunk[] {
  const targetChars = opts.targetChars && opts.targetChars > 0 ? opts.targetChars : DEFAULT_TARGET_CHARS;
  const overlapChars = Math.max(
    0,
    Math.min(opts.overlapChars ?? DEFAULT_OVERLAP_CHARS, Math.floor(targetChars / 2)),
  );
  const trimmedTitle = title.trim();
  const body = content.trim();
  if (body.length === 0) return [];

  // Segmentos ya acotados a <= targetChars (los gigantes se sub-parten aquí).
  const segments = splitSegments(body).flatMap((seg) =>
    seg.length > targetChars ? hardSplit(seg, targetChars) : [seg],
  );
  // Contenido sin saltos de párrafo reconocibles (una sola línea gigante).
  if (segments.length === 0 && body.length > 0) {
    segments.push(...hardSplit(body, targetChars));
  }

  const rawChunks: string[] = [];
  let buffer = "";
  for (const seg of segments) {
    const candidate = buffer.length > 0 ? `${buffer}\n\n${seg}` : seg;
    if (candidate.length > targetChars && buffer.length > 0) {
      rawChunks.push(buffer);
      const tail = buffer.slice(Math.max(0, buffer.length - overlapChars));
      buffer = tail.length > 0 ? `${tail}\n\n${seg}` : seg;
    } else {
      buffer = candidate;
    }
  }
  if (buffer.length > 0) rawChunks.push(buffer);
  if (rawChunks.length === 0) rawChunks.push(body.slice(0, targetChars));

  return rawChunks.map((text, i) => ({
    chunkIndex: i,
    text: trimmedTitle ? `${trimmedTitle}\n\n${text}` : text,
  }));
}
