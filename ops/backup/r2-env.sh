#!/bin/sh
# Config del remoto rclone `r2` a partir del token S3 de Cloudflare R2.
# COMPARTIDA por backup.sh y prune.sh (source: `. /ops/r2-env.sh`): así el
# operador solo setea las 3 credenciales y ambos scripts ven el mismo remoto.
export RCLONE_CONFIG_R2_TYPE=s3
export RCLONE_CONFIG_R2_PROVIDER=Cloudflare
export RCLONE_CONFIG_R2_ACCESS_KEY_ID="${R2_ACCESS_KEY_ID:?falta R2_ACCESS_KEY_ID}"
export RCLONE_CONFIG_R2_SECRET_ACCESS_KEY="${R2_SECRET_ACCESS_KEY:?falta R2_SECRET_ACCESS_KEY}"
export RCLONE_CONFIG_R2_ENDPOINT="https://${R2_ACCOUNT_ID:?falta R2_ACCOUNT_ID}.r2.cloudflarestorage.com"
export RCLONE_CONFIG_R2_ACL=private
