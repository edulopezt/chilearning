import JSZip from "jszip";

/**
 * Wrapper FINO sobre jszip (ADR-lite, task 3.12; extraído de `zip.ts` en la
 * task 5.13): solo ARMADO de un .zip en memoria (Buffer). SIN `server-only` a
 * propósito — el worker (`tenant-export-runner.ts`, job `tenant-export-tick`)
 * corre fuera de Next y lo importa por ruta RELATIVA; `zip.ts` sigue siendo el
 * punto de entrada server-only para el resto de la app (cero cambio de
 * comportamiento para sus llamadores actuales).
 */
export async function buildZip(files: readonly { name: string; bytes: Uint8Array }[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return buf;
}
