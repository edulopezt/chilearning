# RESTORE.md — Runbook de restauración de base de datos

> Cumple P9 (el negocio es recuperable): la restauración debe estar **documentada y
> ensayada** (RTO ≤ 4 h, RPO ≤ 24 h). Este runbook cubre el entorno de **desarrollo**
> hoy; las secciones de staging/producción se completan al montar backups off-site
> (Cloudflare R2, bloque [H3] del `.env`, tarea del Hito 3).

## Ensayos registrados

| # | Fecha | Entorno | Escenario | Resultado | Tiempo |
|---|---|---|---|---|---|
| 1 | 2026-07-14 | dev (Supabase local) | Borrado total de `memberships` (14 filas) → restauración | ✅ 14 → 0 → 14 filas | < 1 min |
| 2 | 2026-07-15 | dev (Supabase local) | Esquema completo Hito 0: borrado de `courses`/`actions`/`enrollments`/`lessons` → restauración | ✅ todos los conteos restaurados (tenants 2, memberships 14, courses 1, lessons 2, enrollments 1) | 34 s |
| 3 | 2026-07-16 | dev (Supabase local) | **Ensayo del pipeline off-site (task 3.7):** `pg_dump` del esquema completo Hito 3 (`ops/backup/backup.sh`) → verificación del dump | ✅ dump 468 KB con todas las tablas nuevas (tenants, certificates, survey_responses, message_threads, …); conteos OK (tenants 2, memberships 14). El paso `age`+`rclone`→R2 queda para el ensayo con cuenta real (handoff) | < 1 min |
| **4** | **2026-07-16** | **backup REAL de R2 → restore local (tarea 4.4, §8.3)** | **Ensayo end-to-end COMPLETO:** descargar el dump cifrado real de R2 (`db-…T080000Z.sql.gz.age`) → verificar SHA-256 (cadena R2→contenedor→host→local idéntica) → **descifrar con la clave `age` privada de Edu** → `gunzip` → restaurar en una BD limpia (`restore_drill`) en el Postgres local → verificar integridad | ✅ **datos íntegros** (tenants 2, memberships 14, sence_sessions 2, sence_events 3, audit_log 2, auth.users 15); 40 tablas con RLS; triggers INSERT-only de `sence_events` presentes. Solo **2 errores no-fatales** en internals de Supabase (`vault.secrets`, un parámetro restringido), ninguno en datos de negocio | **~49 s** (descifrado + restore; RTO ≪ 4 h) |

> **✅ Criterio §8.3 CUMPLIDO** (restauración ensayada con éxito ≥ 2 veces antes del piloto): el
> **ensayo #4** es el end-to-end REAL (backup off-site cifrado de R2 + descifrado `age` + restore),
> además de los locales #1–#3. La clave `age` privada de Edu (offline, `age-key.txt`) descifra el
> backup correctamente — **verificado**: su clave pública derivada coincide con el recipiente del backup.
>
> **Hallazgos del ensayo #4 (fricción real, para un restore de producción):**
> 1. **`--no-privileges`**: `ops/backup/backup.sh` dumpea con `pg_dump --no-owner --no-privileges`, así
>    que el backup trae esquema (tablas, policies, triggers, índices) + DATOS pero **NO los GRANTs de
>    columna/tabla**. Un restore real debe **re-aplicar los grants corriendo las migraciones** tras
>    cargar los datos (las migraciones están en Git). Por eso en el restore `callback_nonce` aparece
>    "sin grant": no hay ningún grant en el dump, no es que la migración lo ocultara.
> 2. **Cluster completo**: el dump incluye los esquemas gestionados de Supabase (`auth`, `storage`,
>    `vault`, `extensions`, …). Restaurar en una BD **nueva dentro del Postgres de Supabase** (los roles
>    `authenticated`/`anon`/`service_role` existen a nivel de cluster) funciona con solo 2 errores
>    benignos. Un restore de producción va a un **proyecto Supabase nuevo/limpio** (que ya provee esos
>    esquemas y roles) — ver el checklist de abajo.

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

## Staging y producción (backup off-site ✅ montado y restore ✅ ensayado)

El backup off-site cifrado está FUNCIONANDO (cron diario a R2) y el restore end-to-end quedó
**ensayado con éxito** (ensayo #4, §8.3). Parámetros:

- **Backup:** dump cifrado diario de la BD gestionada de Supabase → Cloudflare R2
  (`R2_*` en `.env`), retención ≥ 30 días. RPO objetivo ≤ 24 h.
- **Restauración:** documentar aquí el procedimiento exacto (descargar el dump de
  R2, descifrar, restaurar en un proyecto Supabase limpio, repuntar la app) y
  **cronometrarlo** en cada ensayo mensual. RTO objetivo ≤ 4 h.
- **Regla dura (P6):** la restauración de producción la aprueba y supervisa Edu;
  jamás se toca producción a mano fuera de este procedimiento.

### Checklist de un restore de producción (VALIDADO en el ensayo #4, 2026-07-16)

Comandos reales del ensayo #4 (ajustar el destino a un proyecto Supabase nuevo en un incidente real):

1. **Confirmar alcance** y declarar RPO/RTO del evento.
2. **Descargar** el último dump válido de R2 (desde el contenedor de backup, sin exponer secretos):
   ```sh
   ssh clawbot 'docker exec <contenedor-backup> sh -c ". /ops/r2-env.sh; rclone copy \
     \"r2:\$R2_BUCKET/db/AAAA/MM/db-XXXX.sql.gz.age\" /tmp/drill/"'
   # docker cp al host + scp al equipo de restore
   ```
3. **Verificar checksum** (`Get-FileHash -Algorithm SHA256` / `sha256sum`) contra el origen.
4. **Descifrar** con la clave `age` privada (la custodia Edu OFFLINE, `age-key.txt` — jamás en el chat/repo):
   ```sh
   age -d -i <ruta>/age-key.txt db-XXXX.sql.gz.age | gunzip -c > db.sql
   ```
5. **Restaurar** en un proyecto Supabase **nuevo/limpio** (no sobre el dañado). En el ensayo se usó una
   BD nueva en el Postgres local; en producción, un proyecto Supabase nuevo (provee `auth`/`storage` +
   roles):
   ```sh
   psql "$TARGET_DB_URL" -v ON_ERROR_STOP=0 < db.sql   # 2 errores benignos esperados (vault.secrets, 1 parámetro)
   ```
6. **Re-aplicar los GRANTs** corriendo las migraciones (el dump usa `--no-privileges`, así que NO trae
   grants — ver Hallazgo #1 arriba). En producción: aplicar el SQL de `supabase/migrations/` por la
   Management API (idempotencia: los `create` fallarán, pero los `grant`/`revoke` re-aplican los permisos;
   o mantener un script de solo-grants). ⚠ Este paso es OBLIGATORIO o el cliente autenticado no verá nada.
7. **Verificar integridad:** conteos por tabla clave, triggers INSERT-only presentes, RLS activa:
   ```sql
   select 'tenants',count(*) from public.tenants
   union all select 'memberships',count(*) from public.memberships
   union all select 'sence_sessions',count(*) from public.sence_sessions
   union all select 'sence_events',count(*) from public.sence_events
   union all select 'audit_log',count(*) from public.audit_log;
   select count(*) from pg_tables t join pg_class c on c.relname=t.tablename
     where t.schemaname='public' and c.relrowsecurity;  -- RLS activa
   ```
8. **Repuntar la app** (variables de entorno) al proyecto restaurado.
9. **Smoke test:** login, un curso, un registro SENCE en `rcetest`.
10. **Borrado seguro** del dump plano descifrado (PII, Ley 21.719) y de la BD de prueba.
11. **Registrar** el ensayo/incidente en la tabla de arriba con su tiempo real.

> **Regla dura (P6):** la restauración de producción la aprueba y supervisa Edu; jamás se toca
> producción a mano fuera de este procedimiento.
