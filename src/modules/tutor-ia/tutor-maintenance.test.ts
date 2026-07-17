/**
 * Unitarios de `purgeOldConversations` (task 5.8a, HU-11.3) sin IO real: fakes
 * mínimos de `SupabaseClient` que solo implementan la cadena de llamadas que
 * el código realmente usa. Cubren el hallazgo de revisión (MED): antes, un
 * fallo del SELECT dejaba el `console.error` como código muerto (el `return`
 * temprano lo hacía inalcanzable), y ni el DELETE de `tutor_messages` ni el de
 * `tutor_conversations` chequeaban `.error` — un fallo real de la purga por
 * retención (Ley 21.719/HU-11.3) se reportaba igual como éxito con 0 filas.
 */
import { describe, expect, it, vi } from "vitest";

import { purgeOldConversations } from "./tutor-maintenance";

interface Page {
  data: { id: string }[] | null;
  error: { message: string } | null;
}

function fakeDb(opts: {
  select: Page;
  deleteMessages?: Page;
  deleteConversations?: Page;
}): { db: unknown; deleteMessagesFn: ReturnType<typeof vi.fn>; deleteConversationsFn: ReturnType<typeof vi.fn> } {
  const deleteMessages = opts.deleteMessages ?? { data: [], error: null };
  const deleteConversations = opts.deleteConversations ?? { data: [], error: null };

  const deleteMessagesFn = vi.fn(() => ({
    in: () => ({ select: () => Promise.resolve(deleteMessages) }),
  }));
  const deleteConversationsFn = vi.fn(() => ({
    in: () => ({ select: () => Promise.resolve(deleteConversations) }),
  }));

  const db = {
    from: (table: string) => {
      if (table === "tutor_conversations") {
        return {
          select: () => ({ lt: () => Promise.resolve(opts.select) }),
          delete: deleteConversationsFn,
        };
      }
      if (table === "tutor_messages") {
        return { delete: deleteMessagesFn };
      }
      throw new Error(`fakeDb: tabla inesperada "${table}"`);
    },
  };
  return { db, deleteMessagesFn, deleteConversationsFn };
}

describe("purgeOldConversations — manejo de errores (hallazgo MED: fallo silencioso)", () => {
  it("sin conversaciones vencidas: retorna 0/0 y NO loguea error", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, deleteMessagesFn, deleteConversationsFn } = fakeDb({ select: { data: [], error: null } });

    const result = await purgeOldConversations(db as never, new Date().toISOString());

    expect(result).toEqual({ purgedMessages: 0, purgedConversations: 0 });
    expect(spy).not.toHaveBeenCalled();
    expect(deleteMessagesFn).not.toHaveBeenCalled();
    expect(deleteConversationsFn).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("el SELECT falla: SE loguea (antes era código muerto) y NO intenta ningún DELETE", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db, deleteMessagesFn, deleteConversationsFn } = fakeDb({
      select: { data: null, error: { message: "conexión perdida" } },
    });

    const result = await purgeOldConversations(db as never, new Date().toISOString());

    expect(result).toEqual({ purgedMessages: 0, purgedConversations: 0 });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("fallo listando conversaciones vencidas"),
      expect.objectContaining({ message: "conexión perdida" }),
    );
    // Antes del fix, el early-return con `ids=[]` ocurría SIEMPRE que
    // `staleConversations.error` estaba seteado (data queda null → ids=[]),
    // así que este log era inalcanzable. Ahora se llega ANTES del return.
    expect(deleteMessagesFn).not.toHaveBeenCalled();
    expect(deleteConversationsFn).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("el DELETE de tutor_messages falla: SE loguea (antes se ignoraba en silencio)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({
      select: { data: [{ id: "conv-1" }], error: null },
      deleteMessages: { data: null, error: { message: "fk violation" } },
      deleteConversations: { data: [{ id: "conv-1" }], error: null },
    });

    const result = await purgeOldConversations(db as never, new Date().toISOString());

    // El resumen sigue siendo best-effort (no lanza), pero YA NO es un 0
    // silencioso indistinguible de "nada que purgar" en los logs.
    expect(result).toEqual({ purgedMessages: 0, purgedConversations: 1 });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("fallo borrando mensajes vencidos"),
      expect.objectContaining({ message: "fk violation" }),
    );
    spy.mockRestore();
  });

  it("el DELETE de tutor_conversations falla: SE loguea (antes se ignoraba en silencio)", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({
      select: { data: [{ id: "conv-1" }], error: null },
      deleteMessages: { data: [{ id: "msg-1" }], error: null },
      deleteConversations: { data: null, error: { message: "timeout" } },
    });

    const result = await purgeOldConversations(db as never, new Date().toISOString());

    expect(result).toEqual({ purgedMessages: 1, purgedConversations: 0 });
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining("fallo borrando conversaciones vencidas"),
      expect.objectContaining({ message: "timeout" }),
    );
    spy.mockRestore();
  });

  it("camino feliz: purga y retorna los conteos reales, sin loguear nada", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    const { db } = fakeDb({
      select: { data: [{ id: "conv-1" }, { id: "conv-2" }], error: null },
      deleteMessages: { data: [{ id: "m1" }, { id: "m2" }, { id: "m3" }], error: null },
      deleteConversations: { data: [{ id: "conv-1" }, { id: "conv-2" }], error: null },
    });

    const result = await purgeOldConversations(db as never, new Date().toISOString());

    expect(result).toEqual({ purgedMessages: 3, purgedConversations: 2 });
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });
});
