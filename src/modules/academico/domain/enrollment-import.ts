import { isValidRun, MAX_RUN_LENGTH, normalizeRun } from "@/modules/sence/domain/run";
import { parseGrupo } from "@/modules/academico/domain/enrollment-group";

/**
 * Import de inscripciones desde CSV/Excel (task 1.3, HU-2.2/3.2/3.3).
 * Lógica de dominio PURA (sin IO): parsea, valida fila a fila y produce un
 * reporte. Regla del gate F1: "reporta fila a fila SIN insertar basura" — este
 * módulo separa las filas válidas de las inválidas; el servicio solo inserta
 * las válidas.
 *
 * Columnas esperadas (encabezado, insensible a mayúsculas/acentos):
 *   nombre, email, run, exento (opcional), apellidos (opcional — task 2.4:
 *   el export SENCE separa NOMBRES/APELLIDOS; jamás se parte un nombre
 *   compuesto de forma heurística, así que si falta la columna, apellidos
 *   queda vacío), grupo (opcional — planillas reales del OTEC:
 *   `Sence-<código del curso>` = alumno SENCE, `Becario` = exento I-14;
 *   el código se valida contra el curso de la acción destino para que una
 *   planilla no caiga en el curso equivocado).
 */

export const IMPORT_COLUMNS = ["nombre", "apellidos", "email", "run", "exento", "grupo"] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

/** Largo máximo de nombre/apellidos (check de la columna en enrollments). */
export const MAX_NAME_LENGTH = 150;

export interface ValidEnrollmentRow {
  /** Número de fila en el archivo (1-based, sin contar el encabezado). */
  rowNumber: number;
  nombre: string;
  /** Vacío si el archivo no trae la columna (nunca se parte el nombre). */
  apellidos: string;
  email: string;
  /** RUN normalizado (sin puntos, con guión, DV en minúscula si es k). */
  run: string;
  exento: boolean;
}

export type RowErrorField = "nombre" | "apellidos" | "email" | "run" | "exento" | "grupo" | "row";

export interface RowError {
  rowNumber: number;
  field: RowErrorField;
  message: string;
}

export interface ImportReport {
  valid: ValidEnrollmentRow[];
  errors: RowError[];
  /** Total de filas de datos leídas (sin el encabezado). */
  totalRows: number;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Normaliza un encabezado: minúsculas, sin acentos ni espacios. */
function canonicalHeader(raw: string): string {
  const decomposed = raw.trim().toLowerCase().normalize("NFD");
  let out = "";
  for (const ch of decomposed) {
    const code = ch.codePointAt(0) ?? 0;
    if (code >= 0x0300 && code <= 0x036f) continue; // marca diacrítica combinante
    if (ch === " " || ch === "	") continue;
    out += ch;
  }
  return out;
}

/** Parser CSV mínimo con soporte de comillas dobles y separador `,` o `;`. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let field = "";
  let row: string[] = [];
  let inQuotes = false;
  // Autodetecta `;` (común en Excel es-CL) vs `,` mirando la primera línea.
  const firstLine = text.slice(0, text.search(/\r?\n/) === -1 ? text.length : text.search(/\r?\n/));
  const delimiter = firstLine.split(";").length > firstLine.split(",").length ? ";" : ",";

  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (inQuotes) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += char;
      }
    } else if (char === '"') {
      inQuotes = true;
    } else if (char === delimiter) {
      row.push(field);
      field = "";
    } else if (char === "\n") {
      row.push(field);
      rows.push(row);
      row = [];
      field = "";
    } else if (char === "\r") {
      // ignora: el \n siguiente cierra la fila
    } else {
      field += char;
    }
  }
  // Última fila si el archivo no termina en salto de línea.
  if (field !== "" || row.length > 0) {
    row.push(field);
    rows.push(row);
  }
  return rows;
}

/** Interpreta el valor de "exento" con tolerancia (es-CL). */
function parseExento(raw: string | undefined): boolean | null {
  const v = (raw ?? "").trim().toLowerCase();
  if (v === "") return false; // ausente = no exento
  if (["si", "sí", "true", "1", "x", "exento"].includes(v)) return true;
  if (["no", "false", "0"].includes(v)) return false;
  return null; // valor no reconocido → error de fila
}

export interface ValidateOptions {
  /**
   * Código SENCE del curso de la acción destino, para validar el grupo
   * `Sence-<código>` de la planilla (HU-2.2). `null` = el curso NO tiene
   * código SENCE (usar `Sence-…` es error de fila); `undefined` = validación
   * de coincidencia apagada (solo formato) — para usos sin contexto de acción.
   */
  actionCodSence?: string | null;
}

/**
 * Valida el contenido completo de un CSV y devuelve el reporte fila a fila.
 * No lanza: los problemas de formato del encabezado se reportan como un error
 * de fila 0.
 */
export function validateEnrollmentCsv(text: string, opts: ValidateOptions = {}): ImportReport {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== "")); // descarta líneas vacías
  const errors: RowError[] = [];

  if (rows.length === 0) {
    return { valid: [], errors: [{ rowNumber: 0, field: "row", message: "El archivo está vacío." }], totalRows: 0 };
  }

  const header = (rows[0] ?? []).map(canonicalHeader);
  const idx = {
    nombre: header.indexOf("nombre"),
    apellidos: header.indexOf("apellidos"),
    email: header.indexOf("email"),
    run: header.indexOf("run"),
    exento: header.indexOf("exento"),
    grupo: header.indexOf("grupo"),
  };

  const missing = (["nombre", "email", "run"] as const).filter((c) => idx[c] === -1);
  if (missing.length > 0) {
    return {
      valid: [],
      errors: [
        {
          rowNumber: 0,
          field: "row",
          message: `Faltan columnas obligatorias en el encabezado: ${missing.join(", ")}.`,
        },
      ],
      totalRows: rows.length - 1,
    };
  }

  const valid: ValidEnrollmentRow[] = [];
  const seenRuns = new Map<string, number>();
  const seenEmails = new Map<string, number>();

  for (let i = 1; i < rows.length; i++) {
    const cells = rows[i] ?? [];
    const rowNumber = i; // 1-based sobre datos
    const cell = (c: number): string => (c >= 0 ? (cells[c] ?? "").trim() : "");

    const nombre = cell(idx.nombre);
    const apellidos = idx.apellidos >= 0 ? cell(idx.apellidos) : "";
    const email = cell(idx.email);
    const runRaw = cell(idx.run);
    const exentoRaw = idx.exento >= 0 ? cell(idx.exento) : "";
    const grupoRaw = idx.grupo >= 0 ? cell(idx.grupo) : "";

    const rowErrors: RowError[] = [];

    if (nombre === "") {
      rowErrors.push({ rowNumber, field: "nombre", message: "El nombre es obligatorio." });
    } else if (nombre.length > MAX_NAME_LENGTH) {
      rowErrors.push({
        rowNumber,
        field: "nombre",
        message: `El nombre supera los ${MAX_NAME_LENGTH} caracteres.`,
      });
    }
    if (apellidos.length > MAX_NAME_LENGTH) {
      rowErrors.push({
        rowNumber,
        field: "apellidos",
        message: `Los apellidos superan los ${MAX_NAME_LENGTH} caracteres.`,
      });
    }

    if (email === "") {
      rowErrors.push({ rowNumber, field: "email", message: "El correo es obligatorio." });
    } else if (!EMAIL_RE.test(email)) {
      rowErrors.push({ rowNumber, field: "email", message: `Correo con formato inválido: "${email}".` });
    }

    const run = normalizeRun(runRaw);
    if (runRaw === "") {
      rowErrors.push({ rowNumber, field: "run", message: "El RUN es obligatorio." });
    } else if (run.length > MAX_RUN_LENGTH || !isValidRun(run)) {
      rowErrors.push({ rowNumber, field: "run", message: `RUN inválido (revisa el dígito verificador): "${runRaw}".` });
    }

    const exento = parseExento(exentoRaw);
    if (exento === null) {
      rowErrors.push({ rowNumber, field: "exento", message: `Valor de "exento" no reconocido: "${exentoRaw}" (usa Sí/No).` });
    }

    // Grupo operativo del OTEC (HU-2.2): decide `exento` cuando viene y se
    // valida contra el curso de la acción (planilla equivocada = filas rechazadas).
    const grupo = parseGrupo(grupoRaw);
    if (grupo.kind === "invalid") {
      // Con el código del curso a mano, el mensaje dice el valor EXACTO esperado.
      const expected = opts.actionCodSence ? `"Sence-${opts.actionCodSence}"` : `"Sence-<código del curso>"`;
      rowErrors.push({
        rowNumber,
        field: "grupo",
        message: `Valor de "grupo" no reconocido: "${grupoRaw}" (usa ${expected} o "Becario").`,
      });
    } else if (grupo.kind === "sence") {
      if (opts.actionCodSence === null) {
        rowErrors.push({
          rowNumber,
          field: "grupo",
          message: `El grupo "${grupoRaw}" no aplica: el curso de la acción destino no tiene código SENCE.`,
        });
      } else if (opts.actionCodSence !== undefined && grupo.code !== opts.actionCodSence) {
        rowErrors.push({
          rowNumber,
          field: "grupo",
          message: `El grupo "${grupoRaw}" no coincide con el código SENCE del curso de esta acción (Sence-${opts.actionCodSence}). ¿Planilla equivocada?`,
        });
      }
      // Contradicción explícita entre columnas (solo si exento venía escrito).
      if (exentoRaw !== "" && exento === true) {
        rowErrors.push({
          rowNumber,
          field: "grupo",
          message: `La fila dice exento "Sí" pero el grupo es "${grupoRaw}" (alumno SENCE): corrige una de las dos columnas.`,
        });
      }
    } else if (grupo.kind === "becario" && exentoRaw !== "" && exento === false) {
      rowErrors.push({
        rowNumber,
        field: "grupo",
        message: `La fila dice exento "No" pero el grupo es "Becario": corrige una de las dos columnas.`,
      });
    }

    // El grupo manda sobre `exento` cuando viene: Becario → exento; Sence → no.
    const effectiveExento =
      grupo.kind === "becario" ? true : grupo.kind === "sence" ? false : (exento ?? false);

    // Duplicados DENTRO del archivo (no insertar basura).
    if (run !== "" && isValidRun(run)) {
      const prev = seenRuns.get(run);
      if (prev !== undefined) {
        rowErrors.push({ rowNumber, field: "run", message: `RUN duplicado en el archivo (ya está en la fila ${prev}).` });
      }
    }
    const emailKey = email.toLowerCase();
    if (email !== "" && EMAIL_RE.test(email)) {
      const prev = seenEmails.get(emailKey);
      if (prev !== undefined) {
        rowErrors.push({ rowNumber, field: "email", message: `Correo duplicado en el archivo (ya está en la fila ${prev}).` });
      }
    }

    if (rowErrors.length > 0) {
      errors.push(...rowErrors);
      continue;
    }

    // Solo se marcan como "vistos" las filas que serán válidas: así la primera
    // ocurrencia queda registrada y la segunda es la que se reporta duplicada.
    seenRuns.set(run, rowNumber);
    seenEmails.set(emailKey, rowNumber);
    valid.push({ rowNumber, nombre, apellidos, email, run, exento: effectiveExento });
  }

  return { valid, errors, totalRows: rows.length - 1 };
}
