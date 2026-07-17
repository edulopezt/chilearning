/**
 * Guardia anti zip-bomb del descriptor SENCE (.docx, task 5.10 + fix de
 * seguridad post-5.10): un .docx es un .zip; `mammoth.extractRawText`
 * (invocado desde `descriptor-extract.ts`, en el WORKER — nunca en el
 * proceso web compartido por todos los tenants, mismo criterio que la
 * ingesta SCORM, ADR-006) descomprimiría CUALQUIER entry declarada sin
 * límite de memoria si no se acota antes — un .docx de pocos MB comprimidos
 * puede inflar a varios GB.
 *
 * `exceedsDescriptorUncompressedBudget` de abajo es SOLO el pre-chequeo
 * BARATO (sin IO, mismo patrón que
 * `contenido/domain/scorm-zip.ts::exceedsUncompressedBudget`) contra el
 * tamaño DECLARADO en el directorio central del .zip — un campo 100%
 * controlado por quien sube el archivo, que un .zip puede fácilmente MENTIR
 * (ver `forgeDeclaredUncompressedSize` en los tests). NO es, por sí solo, una
 * defensa contra un .docx malicioso: la defensa REAL es el streaming de
 * bytes REALES en `descriptor-extract.ts::readEntryBytes`, que mide cada
 * entry mientras se descomprime y aborta apenas se supera el presupuesto,
 * sin importar lo que el directorio central haya declarado. Se combina,
 * además, con `MAX_DESCRIPTOR_TEXT_LENGTH` (misma vara que
 * `readEntryBytes`) como segunda barrera sobre el texto YA extraído.
 */

export const MAX_DESCRIPTOR_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // 50 MB

export function exceedsDescriptorUncompressedBudget(totalUncompressedBytes: number): boolean {
  return totalUncompressedBytes > MAX_DESCRIPTOR_UNCOMPRESSED_BYTES;
}
