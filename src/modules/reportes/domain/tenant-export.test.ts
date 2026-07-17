import { describe, expect, it } from "vitest";

import {
  buildManifest,
  DEFAULT_MAX_EXPORT_BYTES,
  datasetToCsv,
  datasetToJson,
  EXPORT_DATASETS,
  FileBudget,
  hasUniqueDatasetNames,
} from "./tenant-export";

describe("EXPORT_DATASETS", () => {
  it("no tiene nombres de dataset duplicados", () => {
    expect(hasUniqueDatasetNames()).toBe(true);
  });

  it("detecta duplicados cuando SÍ los hay (el positivo de arriba no es un `using(true)`)", () => {
    const dup = [...EXPORT_DATASETS, EXPORT_DATASETS[0]!];
    expect(hasUniqueDatasetNames(dup)).toBe(false);
  });

  it("cada entrada tiene tabla, columnas no vacías y al menos un orderBy", () => {
    for (const entry of EXPORT_DATASETS) {
      expect(entry.table.length).toBeGreaterThan(0);
      expect(entry.columns.length).toBeGreaterThan(0);
      expect(entry.orderBy.length).toBeGreaterThan(0);
    }
  });

  it("solo `tenants` filtra por una columna de tenant distinta de tenant_id", () => {
    const exceptions = EXPORT_DATASETS.filter((e) => e.tenantColumn && e.tenantColumn !== "tenant_id");
    expect(exceptions.map((e) => e.name)).toEqual(["tenants"]);
    expect(exceptions[0]!.tenantColumn).toBe("id");
  });
});

describe("datasetToCsv / datasetToJson", () => {
  const columns = ["id", "name", "roles"];
  const rows = [{ id: "1", name: "Ana", roles: ["student", "tutor"] }];

  it("produce un CSV con encabezados = columnas y celdas jsonb serializadas", () => {
    const csv = datasetToCsv(columns, rows);
    expect(csv).toContain("id;name;roles");
    expect(csv).toContain('"[""student"",""tutor""]"');
  });

  it("neutraliza una celda hostil tipo fórmula (CWE-1236), igual que el resto de los exports", () => {
    const hostile = [{ id: "1", name: "=cmd|' /C calc'!A1", roles: [] }];
    const csv = datasetToCsv(columns, hostile);
    expect(csv).toContain("'=cmd|");
    // Nunca la fórmula cruda sin el apóstrofo de escape delante.
    expect(csv).not.toMatch(/;=cmd/);
  });

  it("nulls y booleanos se serializan de forma estable (no 'null'/'undefined' literal)", () => {
    const withNulls = [{ id: null, name: false, roles: undefined }];
    const csv = datasetToCsv(columns, withNulls as unknown as Record<string, unknown>[]);
    const dataLine = csv.split("\r\n")[1];
    expect(dataLine).toBe(";false;");
  });

  it("produce JSON pretty legible", () => {
    const json = datasetToJson(rows);
    expect(JSON.parse(json)).toEqual(rows);
    expect(json).toContain("\n"); // pretty, no una sola línea
  });
});

describe("FileBudget", () => {
  it("admite archivos mientras quepan en el presupuesto", () => {
    const budget = new FileBudget(100);
    expect(budget.tryAdd("a.csv", 40)).toBe(true);
    expect(budget.tryAdd("b.csv", 40)).toBe(true);
    expect(budget.used).toBe(80);
    expect(budget.omitted).toEqual([]);
  });

  it("omite (y REGISTRA, nunca en silencio) lo que excede el presupuesto", () => {
    const budget = new FileBudget(100);
    expect(budget.tryAdd("a.csv", 60)).toBe(true);
    expect(budget.tryAdd("b.csv", 60)).toBe(false);
    expect(budget.used).toBe(60);
    expect(budget.omitted).toHaveLength(1);
    expect(budget.omitted[0]!.name).toBe("b.csv");
    expect(budget.omitted[0]!.reason).toContain("presupuesto");
  });

  it("recordOmitted registra motivos ajenos al presupuesto (p.ej. archivo faltante en Storage)", () => {
    const budget = new FileBudget();
    budget.recordOmitted("archivos/certificates/x.pdf", "archivo no encontrado en storage");
    expect(budget.omitted).toEqual([{ name: "archivos/certificates/x.pdf", reason: "archivo no encontrado en storage" }]);
    expect(budget.used).toBe(0);
  });

  it("usa el default de 300 MB si no se especifica", () => {
    const budget = new FileBudget();
    expect(budget.maxBytes).toBe(DEFAULT_MAX_EXPORT_BYTES);
  });
});

describe("buildManifest", () => {
  it("arma el manifiesto con schemaVersion, totalBytes (solo lo incluido) y lo omitido", () => {
    const manifest = buildManifest({
      tenantSlug: "seminarea",
      generatedAt: "2026-07-17T12:00:00.000Z",
      datasets: { courses: 3, enrollments: 0 },
      files: {
        included: [{ name: "datasets/courses.csv", bytes: 120 }, { name: "datasets/courses.json", bytes: 200 }],
        omitted: [{ name: "archivos/certificates/x.pdf", reason: "excede el presupuesto del export (10 bytes)" }],
      },
    });
    expect(manifest.schemaVersion).toBe(1);
    expect(manifest.totalBytes).toBe(320);
    expect(manifest.tenantSlug).toBe("seminarea");
    expect(manifest.datasets).toEqual({ courses: 3, enrollments: 0 });
    expect(manifest.files.omitted).toHaveLength(1);
  });
});
