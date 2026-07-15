import { describe, expect, it } from "vitest";

import { computeDv } from "@/modules/sence/domain/run";
import { parseCsv, validateEnrollmentCsv } from "./enrollment-import";

describe("parseCsv", () => {
  it("parsea comas y comillas con separadores dentro", () => {
    const rows = parseCsv('nombre,email\n"Pérez, Juan",juan@x.cl\n');
    expect(rows).toEqual([
      ["nombre", "email"],
      ["Pérez, Juan", "juan@x.cl"],
    ]);
  });

  it("autodetecta el separador ; (Excel es-CL)", () => {
    const rows = parseCsv("nombre;email;run\nAna;ana@x.cl;5126663-3\n");
    expect(rows[1]).toEqual(["Ana", "ana@x.cl", "5126663-3"]);
  });

  it("maneja comillas escapadas y última fila sin salto", () => {
    const rows = parseCsv('a,b\n"di ""hola""",z');
    expect(rows[1]).toEqual(['di "hola"', "z"]);
  });
});

describe("validateEnrollmentCsv", () => {
  it("acepta una fila válida y normaliza el RUN", () => {
    const r = validateEnrollmentCsv("nombre,email,run,exento\nAna Díaz,ana@otec.cl,5.126.663-3,no\n");
    expect(r.errors).toEqual([]);
    expect(r.valid).toHaveLength(1);
    expect(r.valid[0]).toMatchObject({ nombre: "Ana Díaz", email: "ana@otec.cl", run: "5126663-3", exento: false });
  });

  it("reconoce encabezados con acentos/mayúsculas y columna exento opcional", () => {
    const r = validateEnrollmentCsv("Nombre,Email,RUN\nAna,ana@otec.cl,5126663-3\n");
    expect(r.errors).toEqual([]);
    expect(r.valid[0]?.exento).toBe(false);
  });

  it("columna apellidos opcional (task 2.4): presente se lee, ausente queda vacía", () => {
    const con = validateEnrollmentCsv(
      "nombre,apellidos,email,run\nAna,Díaz Rojas,ana@otec.cl,5126663-3\n",
    );
    expect(con.errors).toEqual([]);
    expect(con.valid[0]).toMatchObject({ nombre: "Ana", apellidos: "Díaz Rojas" });

    // Sin la columna, JAMÁS se parte el nombre compuesto de forma heurística.
    const sin = validateEnrollmentCsv("nombre,email,run\nMaría José Pérez,mj@otec.cl,16032460-0\n");
    expect(sin.errors).toEqual([]);
    expect(sin.valid[0]).toMatchObject({ nombre: "María José Pérez", apellidos: "" });
  });

  it("nombre/apellidos sobre 150 caracteres se rechazan (check de la columna)", () => {
    const long = "x".repeat(151);
    const r = validateEnrollmentCsv(
      `nombre,apellidos,email,run\n${long},${long},a@x.cl,5126663-3\n`,
    );
    expect(r.valid).toEqual([]);
    expect(r.errors.map((e) => e.field).sort()).toEqual(["apellidos", "nombre"]);
  });

  it("marca exento con Sí/x/1", () => {
    const r = validateEnrollmentCsv("nombre,email,run,exento\nA,a@x.cl,5126663-3,Sí\n");
    expect(r.valid[0]?.exento).toBe(true);
  });

  it("falla si faltan columnas obligatorias (encabezado)", () => {
    const r = validateEnrollmentCsv("nombre,correo\nAna,ana@x.cl\n");
    expect(r.valid).toEqual([]);
    expect(r.errors[0]?.message).toContain("email");
    expect(r.errors[0]?.field).toBe("row");
  });

  it("reporta RUN con DV inválido sin insertarlo", () => {
    const r = validateEnrollmentCsv("nombre,email,run\nAna,ana@x.cl,5126663-0\n");
    expect(r.valid).toEqual([]);
    expect(r.errors).toEqual([expect.objectContaining({ rowNumber: 1, field: "run" })]);
  });

  it("acumula MÚLTIPLES errores de la misma fila", () => {
    const r = validateEnrollmentCsv("nombre,email,run,exento\n,correo-malo,123-9,tal vez\n");
    const fields = r.errors.filter((e) => e.rowNumber === 1).map((e) => e.field).sort();
    expect(fields).toEqual(["email", "exento", "nombre", "run"]);
    expect(r.valid).toEqual([]);
  });

  it("detecta RUN y email duplicados DENTRO del archivo", () => {
    const csv =
      "nombre,email,run\n" +
      "Ana,ana@x.cl,5126663-3\n" +
      "Ana2,ana@x.cl,11111111-1\n" + // email dup
      "Otro,otro@x.cl,5126663-3\n"; // run dup
    const r = validateEnrollmentCsv(csv);
    expect(r.valid).toHaveLength(1); // solo la primera
    const dupMsgs = r.errors.map((e) => e.message);
    expect(dupMsgs.some((m) => m.includes("Correo duplicado"))).toBe(true);
    expect(dupMsgs.some((m) => m.includes("RUN duplicado"))).toBe(true);
  });

  it("separa válidas de inválidas en un archivo mixto (gate F1)", () => {
    const csv =
      "nombre,email,run,exento\n" +
      "Válida Uno,uno@x.cl,5126663-3,no\n" +
      ",dos@x.cl,11111111-1,no\n" + // sin nombre
      "Tres,tres-malo,7654321-0,si\n" + // email + run malos
      "Cuatro,cuatro@x.cl,16032460-0,x\n"; // válida, exento
    const r = validateEnrollmentCsv(csv);
    expect(r.valid.map((v) => v.nombre)).toEqual(["Válida Uno", "Cuatro"]);
    expect(r.valid[1]?.exento).toBe(true);
    expect(new Set(r.errors.map((e) => e.rowNumber))).toEqual(new Set([2, 3]));
    expect(r.totalRows).toBe(4);
  });

  it("procesa 100 filas: 50 válidas + 50 con DV inválido (gate F1)", () => {
    const lines = ["nombre,email,run"];
    for (let i = 0; i < 50; i++) {
      const okBody = String(10000000 + i); // 8 dígitos únicos
      lines.push(`Alumno ${i},alumno${i}@x.cl,${okBody}-${computeDv(okBody)}`);

      const badBody = String(20000000 + i);
      const correct = computeDv(badBody);
      const wrong = correct === "0" ? "1" : "0"; // DV deliberadamente incorrecto
      lines.push(`Malo ${i},malo${i}@x.cl,${badBody}-${wrong}`);
    }
    const r = validateEnrollmentCsv(lines.join("\n"));
    expect(r.totalRows).toBe(100);
    expect(r.valid).toHaveLength(50);
    expect(r.valid.every((v) => v.email.startsWith("alumno"))).toBe(true);
    expect(r.errors.every((e) => e.field === "run")).toBe(true);
  });

  it("archivo vacío → un error, cero válidas", () => {
    expect(validateEnrollmentCsv("").errors).toHaveLength(1);
    expect(validateEnrollmentCsv("   \n  ").valid).toEqual([]);
  });
});
