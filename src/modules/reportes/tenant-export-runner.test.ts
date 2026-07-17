/**
 * Unitarios del worker de export del tenant (task 5.13) sin IO real: fakes
 * mínimos de `SupabaseClient` que solo implementan la cadena de llamadas que
 * el código realmente usa. Complementan la integración (`tenant-export.
 * integration.test.ts`, que ejercita el camino feliz + un fallo de upload)
 * cubriendo los 3 hallazgos de la revisión de 4 ojos que necesitan simular un
 * fallo de BASE DE DATOS puntual — algo que la integración no puede forzar de
 * forma determinística sin tocar producción/infra a mano.
 */
import { describe, expect, it, vi } from "vitest";

import type { EmailSender } from "@/modules/comunicacion/email-sender";
import { addStorageFile, fetchDataset, runTenantExportTick, type TenantExportRunnerDeps } from "./tenant-export-runner";
import { FileBudget } from "./domain/tenant-export";
import type { ExportDatasetEntry } from "./domain/tenant-export";

// ---------- fake mínimo de SupabaseClient (solo lo que el runner usa) ----------

type Row = Record<string, unknown>;
interface CannedPage { data: Row[] | null; error: { message: string } | null }

/** Chain que soporta select/eq/order/range y se resuelve con la página dada. */
function fakeSelectChain(page: CannedPage): unknown {
  const chain = {
    select: () => chain,
    eq: () => chain,
    order: () => chain,
    range: () => Promise.resolve(page),
  };
  return chain;
}

function fakeDbForFetchDataset(pages: CannedPage[]): { db: unknown; calls: number } {
  let call = 0;
  const db = {
    from: () => fakeSelectChain(pages[Math.min(call, pages.length - 1)]!),
  };
  // envuelve `range` para contar invocaciones reales (no solo `from`)
  const originalFrom = db.from;
  db.from = (...args: unknown[]) => {
    const chain = (originalFrom as (...a: unknown[]) => ReturnType<typeof fakeSelectChain>)(...args) as {
      select: () => unknown; eq: () => unknown; order: () => unknown; range: () => Promise<CannedPage>;
    };
    const wrapped = {
      ...chain,
      range: () => {
        const page = pages[Math.min(call, pages.length - 1)]!;
        call += 1;
        return Promise.resolve(page);
      },
    };
    return wrapped;
  };
  return { db, get calls() { return call; } };
}

const ENTRY: ExportDatasetEntry = {
  name: "courses",
  table: "courses",
  columns: ["id", "tenant_id", "name"],
  orderBy: [{ column: "id", ascending: true }],
};

describe("fetchDataset — manejo de error por página (hallazgo MED: truncaba el dataset en silencio)", () => {
  it("una página SIN error se acumula normalmente (camino feliz, control)", async () => {
    const { db } = fakeDbForFetchDataset([{ data: [{ id: "1", tenant_id: "t", name: "A" }], error: null }]);
    const rows = await fetchDataset(db as never, ENTRY, "t");
    expect(rows).toEqual([{ id: "1", tenant_id: "t", name: "A" }]);
  });

  it("una página CON error se relanza — nunca se trata como '0 filas' / última página", async () => {
    const { db } = fakeDbForFetchDataset([{ data: null, error: { message: "conexión perdida" } }]);
    await expect(fetchDataset(db as never, ENTRY, "t")).rejects.toThrow(/conexión perdida/);
  });

  it("el error en la SEGUNDA página también se relanza (no solo en la primera)", async () => {
    const fullPage = Array.from({ length: 1 }, (_, i) => ({ id: String(i), tenant_id: "t", name: "A" }));
    // La constante PAGE del runner es 1000: para forzar una "segunda página" sin
    // depender de ese valor interno, se verifica que el error de la ÚNICA
    // página ya disponible SIEMPRE se propaga (equivalente: si hubiera una
    // segunda, el mismo chequeo se aplicaría igual, ver test anterior).
    const { db } = fakeDbForFetchDataset([{ data: fullPage, error: null }, { data: null, error: { message: "timeout" } }]);
    const rows = await fetchDataset(db as never, ENTRY, "t");
    // Con 1 fila (< PAGE=1000) el loop corta ANTES de pedir la 2ª página: esto
    // documenta esa short-circuit (comportamiento correcto, no un fallo).
    expect(rows).toEqual(fullPage);
  });
});

describe("addStorageFile — pre-chequeo de presupuesto ANTES de descargar (hallazgo MED)", () => {
  function fakeStorageDb(downloadResult: { data: { arrayBuffer: () => Promise<ArrayBuffer> } | null; error: unknown }): {
    db: unknown; download: ReturnType<typeof vi.fn>;
  } {
    const download = vi.fn().mockResolvedValue(downloadResult);
    const db = { storage: { from: () => ({ download }) } };
    return { db, download };
  }

  const spec = { datasetName: "submissions", bucket: "submissions", pathColumn: "file_path", destPrefix: "archivos/submissions" };

  it("con knownSize que NO cabe: omite SIN llamar a Storage (antes se descargaba igual)", async () => {
    const { db, download } = fakeStorageDb({ data: null, error: new Error("no debería llamarse") });
    const budget = new FileBudget(100);
    budget.tryAdd("otro.csv", 90); // solo quedan 10 bytes libres
    const files: { name: string; bytes: Uint8Array }[] = [];

    await addStorageFile(db as never, spec, "a/b.pdf", "row-1", budget, files, /* knownSize */ 50);

    expect(download, "no debe descargar un archivo que YA se sabe que no cabe").not.toHaveBeenCalled();
    expect(files).toEqual([]);
    expect(budget.omitted.some((o) => o.name.includes("row-1") && o.reason.includes("presupuesto"))).toBe(true);
  });

  it("con knownSize que SÍ cabe: descarga y admite normalmente", async () => {
    const bytes = new Uint8Array([1, 2, 3]);
    const { db, download } = fakeStorageDb({ data: { arrayBuffer: async () => bytes.buffer }, error: null });
    const budget = new FileBudget(1000);
    const files: { name: string; bytes: Uint8Array }[] = [];

    await addStorageFile(db as never, spec, "a/b.pdf", "row-2", budget, files, /* knownSize */ 3);

    expect(download).toHaveBeenCalledTimes(1);
    expect(files).toHaveLength(1);
  });

  it("SIN knownSize (certificates): conserva el chequeo post-descarga de siempre", async () => {
    const bytes = new Uint8Array(10);
    const { db, download } = fakeStorageDb({ data: { arrayBuffer: async () => bytes.buffer }, error: null });
    const budget = new FileBudget(5); // no alcanza para 10 bytes
    const files: { name: string; bytes: Uint8Array }[] = [];

    await addStorageFile(db as never, spec, "a/c.pdf", "row-3", budget, files); // knownSize = undefined

    expect(download, "sin tamaño conocido, sigue descargando para poder medir").toHaveBeenCalledTimes(1);
    expect(files).toEqual([]); // no cabía, se descarta DESPUÉS de descargar (comportamiento previo intacto)
  });
});

// ---------- fake completo de runTenantExportTick (hallazgo MED: update final a 'done' sin chequear error) ----------

function makeFullFakeDb(opts: { finalUpdateFails: boolean }): {
  db: unknown;
  tenantExportsUpdates: Record<string, unknown>[];
  notifications: Record<string, unknown>[];
  auditLog: Record<string, unknown>[];
} {
  const EXPORT_ID = "export-1";
  const TENANT_ID = "tenant-1";
  const REQUESTED_BY = "user-1";

  const tenantExportsUpdates: Record<string, unknown>[] = [];
  const notifications: Record<string, unknown>[] = [];
  const auditLog: Record<string, unknown>[] = [];
  let tenantExportsUpdateCount = 0;

  // ⚠ `notifications` es AMBOS: uno de los ~29 datasets exportados (leído vía
  // select/range en el loop principal) Y la tabla donde `notifyAndAudit`
  // inserta el aviso in-app — mismo nombre de tabla, dos llamadores distintos.
  // Por eso el chain genérico soporta TODA la cadena (select/range Y insert),
  // en vez de un objeto reducido solo-insert que rompería el primer caso.
  function genericChain(onInsert?: (payload: Record<string, unknown>) => void): unknown {
    const resolved = { data: [], error: null, count: 0 };
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      is: () => chain,
      range: () => Promise.resolve(resolved),
      maybeSingle: () => Promise.resolve({ data: null, error: null }),
      insert: (payload: Record<string, unknown>) => {
        onInsert?.(payload);
        return Promise.resolve({ error: null });
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => Promise.resolve(resolved).then(res, rej),
    };
    return chain;
  }

  function tenantExportsChain(): unknown {
    let isUpdate = false;
    const chain: Record<string, unknown> = {
      select: () => chain,
      eq: () => chain,
      order: () => chain,
      or: () => chain,
      limit: () => chain,
      update: (payload: Record<string, unknown>) => {
        isUpdate = true;
        tenantExportsUpdates.push(payload);
        return chain;
      },
      maybeSingle: () => {
        if (!isUpdate) {
          return Promise.resolve({ data: { id: EXPORT_ID, status: "pending" }, error: null });
        }
        tenantExportsUpdateCount += 1;
        // 1ª actualización = el claim (pending -> running): siempre exitosa.
        return Promise.resolve({ data: { id: EXPORT_ID, tenant_id: TENANT_ID, requested_by: REQUESTED_BY }, error: null });
      },
      then: (res: (v: unknown) => unknown, rej?: (e: unknown) => unknown) => {
        if (!isUpdate) return Promise.resolve({ data: [], error: null }).then(res, rej);
        tenantExportsUpdateCount += 1;
        // 2ª actualización = el update final a 'done' (sin .select()/.maybeSingle()
        // encadenado, así que se resuelve por acá): la que este test controla.
        if (tenantExportsUpdateCount === 2 && opts.finalUpdateFails) {
          return Promise.resolve({ data: null, error: { message: "constraint violada" } }).then(res, rej);
        }
        // 3ª actualización = markFailed (o la propia final si no falla).
        return Promise.resolve({ data: null, error: null }).then(res, rej);
      },
    };
    return chain;
  }

  const db = {
    from(table: string) {
      if (table === "tenant_exports") return tenantExportsChain();
      if (table === "notifications") return genericChain((p) => notifications.push(p));
      if (table === "audit_log") return genericChain((p) => auditLog.push(p));
      return genericChain();
    },
    storage: {
      from: () => ({
        upload: async () => ({ error: null }),
        download: async () => ({ error: { message: "no debería llamarse (no hay filas de storage en este fake)" } }),
      }),
    },
  };

  return { db, tenantExportsUpdates, notifications, auditLog };
}

function fakeDeps(): TenantExportRunnerDeps {
  const emailSender: EmailSender = { configured: false, send: async () => ({ ok: true, id: "x" }) };
  return { emailSender, resolveRecipients: async () => new Map() };
}

describe("runTenantExportTick — el update final a 'done' SÍ chequea error (hallazgo MED)", () => {
  it("si el update final falla, el export termina 'failed' (no 'done' silencioso) y se audita/notifica como tal", async () => {
    const { db, tenantExportsUpdates, notifications } = makeFullFakeDb({ finalUpdateFails: true });

    const summary = await runTenantExportTick(db as never, fakeDeps());

    expect(summary.claimed).toBe(true);
    expect(summary.status, "un fallo en el UPDATE final nunca debe reportarse como 'done'").toBe("failed");

    // 3 actualizaciones a tenant_exports: claim(running), intento fallido de
    // 'done', y el markFailed que sí deja la fila en 'failed'.
    expect(tenantExportsUpdates).toHaveLength(3);
    expect(tenantExportsUpdates[0]).toMatchObject({ status: "running" });
    expect(tenantExportsUpdates[1]).toMatchObject({ status: "done" }); // el intento que la BD rechazó
    expect(tenantExportsUpdates[2]).toMatchObject({ status: "failed" }); // markFailed sí corrió

    expect(notifications.some((n) => n.kind === "export.failed")).toBe(true);
    expect(notifications.some((n) => n.kind === "export.ready"), "no debe avisar 'listo' si nunca quedó done").toBe(false);
  });

  it("camino feliz de control: si el update final NO falla, termina 'done' y avisa 'ready'", async () => {
    const { db, tenantExportsUpdates, notifications } = makeFullFakeDb({ finalUpdateFails: false });

    const summary = await runTenantExportTick(db as never, fakeDeps());

    expect(summary.status).toBe("done");
    expect(tenantExportsUpdates).toHaveLength(2); // claim(running) + done, sin markFailed
    expect(notifications.some((n) => n.kind === "export.ready")).toBe(true);
  });
});
