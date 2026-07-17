import JSZip from "jszip";
import { describe, expect, it } from "vitest";

import { buildZip } from "./zip-core";

describe("buildZip (zip-core, sin server-only — task 5.13)", () => {
  it("produce un .zip legible con los archivos dados", async () => {
    const buffer = await buildZip([
      { name: "a.txt", bytes: new TextEncoder().encode("hola") },
      { name: "dir/b.json", bytes: new TextEncoder().encode('{"x":1}') },
    ]);
    expect(buffer.length).toBeGreaterThan(0);

    const zip = await JSZip.loadAsync(buffer);
    // jszip agrega una entrada de directorio implícita ("dir/") además de los
    // 2 archivos declarados: se afirma por inclusión, no por igualdad exacta.
    const names = Object.keys(zip.files);
    expect(names).toContain("a.txt");
    expect(names).toContain("dir/b.json");
    expect(await zip.file("a.txt")!.async("string")).toBe("hola");
    expect(await zip.file("dir/b.json")!.async("string")).toBe('{"x":1}');
  });
});
