# Backup off-site cifrado (task 3.7, Plan §8 / RNF-4)

Pipeline: `pg_dump` → cifra con **age** → sube a **Cloudflare R2** con `rclone`.
Objetivo: RTO ≤ 4 h, RPO ≤ 24 h; backup **fuera** del proveedor del VPS y
**cifrado** en reposo (P9). La clave `age` **privada** la custodia Edu OFFLINE.

## Cómo se despliega (Coolify, handoff a Edu)
1. Crear el bucket **R2** `faro-backups` (Cloudflare → R2) + un API token S3.
2. Generar el par de claves age: `age-keygen -o age-key.txt`. Guardar la PRIVADA
   OFFLINE (fuera del VPS y de git); poner la PÚBLICA (`age1...`) en `AGE_PUBLIC_KEY`.
3. Configurar `rclone` para el remoto `r2` (S3-compatible, endpoint R2).
4. En Coolify: nueva app "backup" desde `ops/backup/Dockerfile`; **Scheduled Task**
   `0 6 * * *` con comando `/ops/backup.sh`; y `0 6 * * 1` → mover el dump del
   lunes a `db-weekly/`; retención con `/ops/prune.sh`.
5. Secrets: `SUPABASE_DB_URL`, `AGE_PUBLIC_KEY`, `R2_BUCKET`, config de rclone,
   `STORAGE_RCLONE_SRC` (opcional, para sincronizar el Storage).

## Restaurar (resumen; detalle en `docs/RESTORE.md`)
```
rclone copy r2:faro-backups/db/2026/07/db-XXXX.sql.gz.age ./
age -d -i age-key.txt db-XXXX.sql.gz.age | gunzip | psql "$TARGET_DB_URL"
```

## Estado
- Scripts y contenedor: **listos** (este directorio).
- Cuenta R2 + clave age + config rclone + Scheduled Tasks: **handoff a Edu**
  (cuesta ~USD 2/mes; decisión de Edu). Hasta entonces no hay backup off-site real.
- Ensayo de restauración #1: ver `docs/RESTORE.md` (hecho contra local/dev).
