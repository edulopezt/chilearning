import { isValidRun, MAX_RUN_LENGTH, normalizeRun } from "@/modules/sence/domain/run";

/**
 * Import de inscripciones desde CSV/Excel (task 1.3, HU-2.2/3.2/3.3).
 * Lógica de dominio PURA (sin IO): parsea, valida fila a fila y produce un
 * reporte. Regla del gate F1: "reporta fila a fila SIN insertar basura" — este
 * módulo separa las filas válidas de las inválidas; el servicio solo inserta
 * las válidas.
 *
 * Columnas esperadas (encabezado, insensible a mayúsculas/acentos):
 *   nombre, email, run, exento (exento es opcional)
 */

export const IMPORT_COLUMNS = ["nombre", "email", "run", "exento"] as const;
export type ImportColumn = (typeof IMPORT_COLUMNS)[number];

export interface ValidEnrollmentRow {
  /** Número de fila en el archivo (1-based, sin contar el encabezado). */
  rowNumber: number;
  nombre: string;
  email: string;
  /** RUN normalizado (sin puntos, con guión, DV en minúscula si es k). */
  run: string;
  exento: boolean;
}

export type RowErrorField = "nombre" | "email" | "run" | "exento" | "row";

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

/**
 * Valida el contenido completo de un CSV y devuelve el reporte fila a fila.
 * No lanza: los problemas de formato del encabezado se reportan como un error
 * de fila 0.
 */
export function validateEnrollmentCsv(text: string): ImportReport {
  const rows = parseCsv(text).filter((r) => r.some((c) => c.trim() !== "")); // descarta líneas vacías
  const errors: RowError[] = [];

  if (rows.length === 0) {
    return { valid: [], errors: [{ rowNumber: 0, field: "row", message: "El archivo está vacío." }], totalRows: 0 };
  }

  const header = (rows[0] ?? []).map(canonicalHeader);
  const idx = {
    nombre: header.indexOf("nombre"),
    email: header.indexOf("email"),
    run: header.indexOf("run"),
    exento: header.indexOf("exento"),
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
    const email = cell(idx.email);
    const runRaw = cell(idx.run);
    const exentoRaw = idx.exento >= 0 ? cell(idx.exento) : "";

    const rowErrors: RowError[] = [];

    if (nombre === "") rowErrors.push({ rowNumber, field: "nombre", message: "El nombre es obligatorio." });

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
    valid.push({ rowNumber, nombre, email, run, exento: exento ?? false });
  }

  return { valid, errors, totalRows: rows.length - 1 };
}
