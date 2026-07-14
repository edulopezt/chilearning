import { describe, expect, it } from "vitest";

import { esCL } from "@/i18n/es-CL";

function collectLeaves(
  node: unknown,
  path: string[] = [],
): Array<{ path: string; value: unknown }> {
  if (typeof node === "object" && node !== null) {
    return Object.entries(node).flatMap(([key, value]) =>
      collectLeaves(value, [...path, key]),
    );
  }
  return [{ path: path.join("."), value: node }];
}

describe("es-CL", () => {
  const leaves = collectLeaves(esCL);

  it("tiene al menos un texto definido", () => {
    expect(leaves.length).toBeGreaterThan(0);
  });

  it("cada hoja es un string no vacío", () => {
    for (const leaf of leaves) {
      expect(typeof leaf.value, `"${leaf.path}" debe ser string`).toBe("string");
      expect((leaf.value as string).trim(), `"${leaf.path}" no debe estar vacío`).not.toBe("");
    }
  });
});
