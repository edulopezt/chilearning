import "server-only";

import JSZip from "jszip";

/**
 * Wrapper FINO sobre jszip (ADR-lite, task 3.12): solo ARMADO de un .zip en
 * memoria (Buffer), server-only. Aislado como `reportes/xlsx.ts`: si algún día se
 * reemplaza, este es el único archivo que cambia.
 */
export async function buildZip(files: readonly { name: string; bytes: Uint8Array }[]): Promise<Buffer> {
  const zip = new JSZip();
  for (const f of files) zip.file(f.name, f.bytes);
  const buf = await zip.generateAsync({ type: "nodebuffer", compression: "DEFLATE", compressionOptions: { level: 6 } });
  return buf;
}
