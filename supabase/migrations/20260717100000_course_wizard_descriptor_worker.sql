-- =============================================================================
-- Fix de seguridad post-5.10 (HU-3.5): el .docx del descriptor SENCE se
-- procesaba (JSZip + mammoth) INLINE en el proceso web compartido por todos
-- los tenants, confiando primero en el tamaño DESCOMPRIMIDO DECLARADO del
-- .zip (controlado por quien sube el archivo) antes de dejar que `mammoth`
-- descomprimiera el buffer COMPLETO sin límite de bytes reales — mismo
-- patrón "confía en el tamaño declarado" ya encontrado bypasseable en la
-- ingesta SCORM (20260717080000_scorm_packages.sql). `runDescriptorExtract`
-- (src/modules/academico/descriptor-extract.ts) mueve ese trabajo al WORKER,
-- con streaming de bytes REALES (mismo criterio que `scorm_packages`).
--
-- `course_drafts.status` gana dos valores nuevos:
--   - 'processing': el .docx ya se subió y se encoló su extracción; el draft
--     aún no es editable (current_step/state siguen en su default vacío).
--   - 'failed': la extracción falló (zip inválido, excede el presupuesto real
--     de bytes descomprimidos, o el texto extraído es demasiado largo).
--     `descriptor_error` guarda el código para mostrarlo en es-CL.
-- =============================================================================

alter table public.course_drafts drop constraint course_drafts_status_check;
alter table public.course_drafts add constraint course_drafts_status_check
  check (status in ('in_progress', 'processing', 'failed', 'generated', 'discarded'));

alter table public.course_drafts add column descriptor_error text check (
  descriptor_error is null or descriptor_error in ('invalid_zip', 'too_large', 'text_too_large', 'storage_error')
);
