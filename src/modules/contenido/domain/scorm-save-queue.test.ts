import { describe, expect, it } from "vitest";

import { createSaveQueue } from "@/modules/contenido/domain/scorm-save-queue";

describe("createSaveQueue (task 5.1b, corrección 4-ojos MED)", () => {
  it("idle → request() dispara de inmediato", () => {
    const q = createSaveQueue();
    expect(q.request()).toBe("start");
  });

  it("una segunda solicitud mientras la primera está en curso se coalesce (no se apila)", () => {
    const q = createSaveQueue();
    expect(q.request()).toBe("start");
    expect(q.request()).toBe("queued");
    // Una TERCERA solicitud durante el mismo envío en curso NO agrega un segundo
    // pendiente — sigue habiendo, como máximo, un reintento coalescido.
    expect(q.request()).toBe("queued");
  });

  it("finish() sin pendiente → idle; una solicitud posterior vuelve a disparar de inmediato", () => {
    const q = createSaveQueue();
    q.request();
    expect(q.finish()).toBe("idle");
    expect(q.request()).toBe("start");
  });

  it("finish() con un pendiente → retry (sigue \"en curso\", el llamador reenvía YA)", () => {
    const q = createSaveQueue();
    q.request(); // start
    q.request(); // queued (coalescido)
    expect(q.finish()).toBe("retry");
  });

  it("simula el escenario de la carrera: 3 solicitudes antes de que la primera termine → solo UN reintento, nunca dos en paralelo", () => {
    const q = createSaveQueue();
    expect(q.request()).toBe("start"); // ej: commit del SCO
    expect(q.request()).toBe("queued"); // ej: heartbeat de 30s casi simultáneo
    expect(q.request()).toBe("queued"); // ej: finish/terminate

    // El envío en curso termina: exactamente UN reintento coalescido.
    expect(q.finish()).toBe("retry");
    // Mientras ese reintento está "en curso", una nueva solicitud se vuelve a coalescer.
    expect(q.request()).toBe("queued");
    // Termina el reintento: como ya no había un pendiente NUEVO antes de este
    // finish, pero SÍ se agregó uno arriba, debe pedir otro retry.
    expect(q.finish()).toBe("retry");
    // Ahora sí, sin más solicitudes pendientes, termina en idle.
    expect(q.finish()).toBe("idle");
  });
});
