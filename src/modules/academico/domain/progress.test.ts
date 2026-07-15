import { describe, expect, it } from "vitest";

import { summarizeProgress } from "./progress";

const L = [{ id: "a" }, { id: "b" }, { id: "c" }, { id: "d" }];

describe("summarizeProgress", () => {
  it("sin lecciones: 100% y sin nada que retomar", () => {
    expect(summarizeProgress([], new Set())).toEqual({
      total: 0,
      completed: 0,
      percent: 100,
      resumeLessonId: null,
      done: false,
    });
  });

  it("ninguna completada: 0% y retoma la primera", () => {
    const r = summarizeProgress(L, new Set());
    expect(r.percent).toBe(0);
    expect(r.resumeLessonId).toBe("a");
    expect(r.done).toBe(false);
  });

  it("retoma la PRIMERA no completada en orden (aunque haya saltos)", () => {
    const r = summarizeProgress(L, new Set(["a", "c"]));
    expect(r.completed).toBe(2);
    expect(r.percent).toBe(50);
    expect(r.resumeLessonId).toBe("b"); // primera pendiente en orden
  });

  it("todas completadas: 100% y done", () => {
    const r = summarizeProgress(L, new Set(["a", "b", "c", "d"]));
    expect(r.percent).toBe(100);
    expect(r.done).toBe(true);
    expect(r.resumeLessonId).toBeNull();
  });

  it("redondea el porcentaje", () => {
    expect(summarizeProgress(L, new Set(["a"])).percent).toBe(25);
    expect(summarizeProgress([{ id: "a" }, { id: "b" }, { id: "c" }], new Set(["a"])).percent).toBe(33);
  });
});
