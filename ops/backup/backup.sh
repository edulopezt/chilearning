#!/bin/sh
# =============================================================================
# Backup off-site cifrado (task 3.7, Plan §8 / RNF-4). Corre como tarea cron en
# Coolify. Pipeline: pg_dump -> cifra con age -> sube a Cloudflare R2 (rclone).
# También sincroniza el Storage. FALLA RUIDOSO (set -e) para que el monitor lo vea.
#
# RTO<=4h, RPO<=24h. La clave age PRIVADA la custodia Edu OFFLINE (nunca en el VPS
# ni en git). Aquí solo va la clave PÚBLICA de cifrado (AGE_PUBLIC_KEY).
#
# Variables de entorno (Coolify secrets):
#   SUPABASE_DB_URL       postgres://... (connection string de la BD a respaldar)
#   AGE_PUBLIC_KEY        age1... (recipiente de cifrado)
#   R2_BUCKET             nombre del bucket (p.ej. chilearning-backups)
#   R2_ACCOUNT_ID         id de cuenta de Cloudflare (arma el endpoint R2)
#   R2_ACCESS_KEY_ID      del token S3 de R2
#   R2_SECRET_ACCESS_KEY  del token S3 de R2
#   STORAGE_RCLONE_SRC    (opcional) remoto/ruta del Storage de Supabase a sincronizar
# =============================================================================
set -eu

: "${SUPABASE_DB_URL:?falta SUPABASE_DB_URL}"
: "${AGE_PUBLIC_KEY:?falta AGE_PUBLIC_KEY}"
: "${R2_BUCKET:?falta R2_BUCKET}"

# Config del remoto rclone `r2` (compartida con prune.sh — 4-ojos: prune corría
# sin remoto). rclone lee las RCLONE_CONFIG_R2_* del entorno.
. "$(dirname "$0")/r2-env.sh"

STAMP="$(date -u +%Y%m%dT%H%M%SZ)"
YEAR="$(date -u +%Y)"
MONTH="$(date -u +%m)"
WORKDIR="$(mktemp -d)"
DUMP="$WORKDIR/db-$STAMP.sql.gz"
ENC="$DUMP.age"

echo "[backup] pg_dump -> $DUMP"
pg_dump "$SUPABASE_DB_URL" --no-owner --no-privileges | gzip -9 > "$DUMP"

echo "[backup] cifrando con age"
age -r "$AGE_PUBLIC_KEY" -o "$ENC" "$DUMP"
rm -f "$DUMP"

echo "[backup] subiendo a R2: db/$YEAR/$MONTH/"
rclone copy "$ENC" "r2:$R2_BUCKET/db/$YEAR/$MONTH/"

echo "[backup] sync del Storage a R2"
# El Storage de Supabase se replica con rclone (bucket S3-compatible o API).
if [ -n "${STORAGE_RCLONE_SRC:-}" ]; then
  rclone sync "$STORAGE_RCLONE_SRC" "r2:$R2_BUCKET/storage/"
fi

rm -rf "$WORKDIR"
echo "[backup] OK $STAMP"
