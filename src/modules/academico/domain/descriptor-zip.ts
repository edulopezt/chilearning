/**
 * Guardia anti zip-bomb del descriptor SENCE (.docx, task 5.10, 4-ojos
 * HIGH/MED "orquestacion-idempotencia"/"validacion-publicacion"): un .docx es
 * un .zip; sin este chequeo, `mammoth.extractRawText` (wizard-service.ts)
 * descomprimiría CUALQUIER entry declarada dentro del PROCESO WEB COMPARTIDO
 * (no el worker aislado, a diferencia de la ingesta SCORM), sin límite de
 * memoria — un .docx de pocos MB comprimidos puede inflar a varios GB.
 *
 * Mismo patrón que `contenido/domain/scorm-zip.ts::exceedsUncompressedBudget`
 * (pre-chequeo BARATO, sin IO, contra el tamaño DECLARADO en el directorio
 * central del .zip), con un presupuesto mucho menor: un descriptor es texto
 * (Anexo 4), no debería superar unos pocos MB descomprimidos aun con logos o
 * imágenes embebidas en el Word. Igual que su contraparte SCORM, este
 * pre-chequeo NO es por sí solo una defensa completa (el campo declarado es
 * controlado por quien sube el archivo) — se combina con
 * `MAX_DESCRIPTOR_TEXT_LENGTH` (wizard-service.ts) como segunda barrera sobre
 * el texto YA extraído, acotando también lo que `extractDescriptor` procesa.
 */

export const MAX_DESCRIPTOR_UNCOMPRESSED_BYTES = 50 * 1024 * 1024; // 50 MB

export function exceedsDescriptorUncompressedBudget(totalUncompressedBytes: number): boolean {
  return totalUncompressedBytes > MAX_DESCRIPTOR_UNCOMPRESSED_BYTES;
}
