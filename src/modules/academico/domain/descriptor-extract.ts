/**
 * Extracción DETERMINISTA (sin IA) del descriptor SENCE (task 5.10, HU-3.5).
 * `wizard-service.ts` extrae el texto plano del .docx con `mammoth` y se lo
 * pasa a `extractDescriptor`; este módulo NO toca IO ni la librería docx, solo
 * aplica heurísticas de texto sobre líneas. NUNCA lanza: ante señales
 * ambiguas o ausentes devuelve `null`/`[]` en ese campo + una entrada en
 * `warnings` para que el usuario lo revise a mano.
 */

export interface DescriptorModule {
  readonly title: string;
  readonly hours: number | null;
}

export interface DescriptorExtract {
  readonly name: string | null;
  readonly totalHours: number | null;
  readonly modules: readonly DescriptorModule[];
  readonly outcomes: readonly string[];
  readonly warnings: readonly string[];
}

const NAME_RE = /NOMBRE\s+(DEL\s+CURSO|DE\s+LA\s+ACTIVIDAD)/i;
// Grupo 1 = las horas. (Sin grupo con nombre: el target ES2017 del proyecto no
// los soporta — ver tsconfig.json.)
const HOURS_RE = /(?:N[°º]?\s*DE\s+)?HORAS(?:\s+(?:TOTALES|CRONOL[OÓ]GICAS))?\s*:?\s*(\d+)/i;
const MODULE_RE = /^M[OÓ]DULO\s*(?:N[°º]?\s*)?\d+/i;
const OUTCOMES_HEADER_RE = /APRENDIZAJES?\s+ESPERADOS?/i;
const BULLET_RE = /^(?:[-•]|\d+[.)])\s*(.+)$/;
// Cabecera de sección: línea toda en mayúsculas (con acentos/números/puntuación
// básica), de largo razonable — corta la recolección de bullets al llegar a otra
// sección del descriptor.
const UPPER_HEADER_RE = /^[A-ZÁÉÍÓÚÑ0-9°º\s.:()-]{4,}$/;

function splitLines(text: string): string[] {
  return text.split(/\r?\n/).map((l) => l.trim());
}

/** Primera línea no vacía DESPUÉS de `idx` (para "resto de la línea o la siguiente no vacía"). */
function firstNonEmptyAfter(lines: readonly string[], idx: number): string | null {
  for (let i = idx + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (line) return line;
  }
  return null;
}

function extractName(lines: readonly string[], warnings: string[]): string | null {
  const idx = lines.findIndex((l) => NAME_RE.test(l));
  if (idx < 0) {
    warnings.push("No se encontró el nombre del curso en el descriptor; revísalo a mano.");
    return null;
  }
  const line = lines[idx] ?? "";
  const rest = line.replace(NAME_RE, "").replace(/^[\s:._-]+/, "").trim();
  const name = rest || firstNonEmptyAfter(lines, idx);
  if (!name) {
    warnings.push("No se encontró el nombre del curso en el descriptor; revísalo a mano.");
    return null;
  }
  return name;
}

function extractTotalHours(lines: readonly string[], warnings: string[]): number | null {
  for (const line of lines) {
    const match = line.match(HOURS_RE);
    if (match?.[1]) return Number(match[1]);
  }
  warnings.push("No se encontraron las horas totales en el descriptor; revísalas a mano.");
  return null;
}

function extractModules(lines: readonly string[], warnings: string[]): DescriptorModule[] {
  const starts: number[] = [];
  lines.forEach((l, i) => {
    if (MODULE_RE.test(l)) starts.push(i);
  });
  if (starts.length === 0) {
    warnings.push("No se encontraron módulos en el descriptor; agrégalos a mano.");
    return [];
  }

  const modules: DescriptorModule[] = starts.map((startIdx, mi) => {
    const endIdx = mi + 1 < starts.length ? (starts[mi + 1] ?? lines.length) : lines.length;
    const line = lines[startIdx] ?? "";
    const rest = line.replace(MODULE_RE, "").replace(/^[\s:._-]+/, "").trim();
    const title = rest || firstNonEmptyAfter(lines, startIdx) || `Módulo ${mi + 1}`;

    let hours: number | null = null;
    for (let i = startIdx; i < endIdx; i += 1) {
      const match = (lines[i] ?? "").match(HOURS_RE);
      if (match?.[1]) {
        hours = Number(match[1]);
        break;
      }
    }
    return { title, hours };
  });

  if (modules.some((m) => m.hours === null)) {
    warnings.push("Algunos módulos no tienen horas detectadas en el descriptor; revísalas a mano.");
  }
  return modules;
}

function extractOutcomes(lines: readonly string[], warnings: string[]): string[] {
  const headerIdx = lines.findIndex((l) => OUTCOMES_HEADER_RE.test(l));
  const outcomes: string[] = [];
  if (headerIdx >= 0) {
    for (let i = headerIdx + 1; i < lines.length; i += 1) {
      const line = lines[i] ?? "";
      if (!line) continue;
      if (MODULE_RE.test(line)) break;
      const bulletMatch = line.match(BULLET_RE);
      if (bulletMatch?.[1]) {
        outcomes.push(bulletMatch[1].trim());
        continue;
      }
      if (UPPER_HEADER_RE.test(line) && !OUTCOMES_HEADER_RE.test(line)) break;
    }
  }
  if (outcomes.length === 0) {
    warnings.push("No se encontraron aprendizajes esperados en el descriptor; agrégalos a mano.");
  }
  return outcomes;
}

/**
 * Extrae nombre, horas totales, módulos (con sus horas) y aprendizajes
 * esperados del texto plano de un descriptor SENCE (.docx ya convertido a
 * texto). SIEMPRE retorna algo — parcial y con `warnings` si el texto no trae
 * ninguna señal reconocible.
 */
export function extractDescriptor(rawText: string): DescriptorExtract {
  const lines = splitLines(rawText ?? "");
  const warnings: string[] = [];

  const name = extractName(lines, warnings);
  const totalHours = extractTotalHours(lines, warnings);
  const modules = extractModules(lines, warnings);
  const outcomes = extractOutcomes(lines, warnings);

  return { name, totalHours, modules, outcomes, warnings };
}

/**
 * Punto de integración FUTURO (task 5.8, tutor IA): un enhancer opcional que
 * tome la extracción determinista de arriba y la complemente/corrija con IA
 * (p.ej. inferir módulos mal formateados, resumir aprendizajes largos). Solo
 * se declara el TIPO acá — ningún enhancer con IA se implementa en este
 * archivo (el módulo sigue siendo 100% determinista y sin dependencias
 * externas, RNF-10).
 */
export type DescriptorEnhancer = (
  extract: ReturnType<typeof extractDescriptor>,
  rawText: string,
) => Promise<ReturnType<typeof extractDescriptor>>;
