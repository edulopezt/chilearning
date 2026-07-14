# RESTORE.md — Runbook de restauración de base de datos

> Cumple P9 (el negocio es recuperable): la restauración debe estar **documentada y
> ensayada** (RTO ≤ 4 h, RPO ≤ 24 h). Este runbook cubre el entorno de **desarrollo**
> hoy; las secciones de staging/producción se completan al montar backups off-site
> (Cloudflare R2, bloque [H3] del `.env`, tarea del Hito 3).

## Ensayos registrados

| # | Fecha | Entorno | Escenario | Resultado | Tiempo |
|---|---|---|---|---|---|
| 1 | 2026-07-14 | dev (Supabase local) | Borrado total de `memberships` (14 filas) → restauración | ✅ 14 → 0 → 14 filas | < 1 min |

> El **ensayo #2** (exigido antes del piloto, Hito 3/4) se registrará aquí.

---

## Entorno de desarrollo (Supabase local)

La BD de desarrollo es **desechable y reproducible**: su fuente de verdad son las
migraciones versionadas (`supabase/migrations/`) + los seeds (`supabase/seed.sql`).
No contiene datos que no puedan regenerarse.

### Restauración canónica (recrear desde cero)

```bash
supabase db reset
```

Aplica todas las migraciones en orden y ejecuta los seeds (2 tenants × 8 roles,
datos ficticios). Es el método normal de recuperación en dev. **Verificación:**

```bash
# Deben devolver 2 y 14 respectivamente
docker exec supabase_db_lms-marca psql -U postgres -d postgres -tAc \
  "select count(*) from public.tenants; select count(*) from public.memberships;"
```

### Snapshot puntual (antes de un experimento riesgoso)

```bash
# Dump del esquema public a un archivo
docker exec supabase_db_lms-marca pg_dump -U postgres -d postgres \
  --schema=public --no-owner > snapshot.sql

# Restaurar ese snapshot
docker exec -i supabase_db_lms-marca psql -U postgres -d postgres < snapshot.sql
```

> ⚠ Las tablas INSERT-only (`audit_log`, `sence_events`) tienen triggers que
> bloquean UPDATE/DELETE/TRUNCATE incluso para el owner: un `psql < snapshot.sql`
> que intente recargarlas fallará en esas tablas. Para un restore completo usa
> `supabase db reset` (recrea el esquema desde cero) en vez de recargar un dump
> sobre una BD existente.

---

## Staging y producción (pendiente — Hito 3)

Cuando se monte el backup off-site (tarea del Hito 3, ADR/plan §7-§9):

- **Backup:** dump cifrado diario de la BD gestionada de Supabase → Cloudflare R2
  (`R2_*` en `.env`), retención ≥ 30 días. RPO objetivo ≤ 24 h.
- **Restauración:** documentar aquí el procedimiento exacto (descargar el dump de
  R2, descifrar, restaurar en un proyecto Supabase limpio, repuntar la app) y
  **cronometrarlo** en cada ensayo mensual. RTO objetivo ≤ 4 h.
- **Regla dura (P6):** la restauración de producción la aprueba y supervisa Edu;
  jamás se toca producción a mano fuera de este procedimiento.

### Checklist de un restore de producción (borrador, a validar en el ensayo #2)

- [ ] Confirmar el alcance del incidente y declarar RPO/RTO objetivo del evento
- [ ] Descargar el último dump válido desde R2 y verificar su checksum
- [ ] Descifrar el dump
- [ ] Restaurar en un proyecto Supabase **nuevo/limpio** (no sobre el dañado)
- [ ] Correr migraciones pendientes si el dump es más antiguo que el esquema
- [ ] Verificar integridad: conteos por tabla, `audit_log`/`sence_events` intactos
- [ ] Repuntar la app (variables de entorno) al proyecto restaurado
- [ ] Smoke test: login, un curso, un registro SENCE en `rcetest`
- [ ] Registrar el ensayo/incidente en la tabla de arriba con su tiempo real
