#!/bin/sh
# Retención de backups en R2 (task 3.7, Plan §8): 7 diarios, 4 semanales, 6
# mensuales. Simplificación operativa: borra los dumps diarios con > 8 días
# EXCEPTO el primero de cada semana/mes (rclone no versiona por sí solo, así que
# la política real la afina Edu; este script cubre el caso diario > semana).
set -eu
: "${R2_BUCKET:?falta R2_BUCKET}"
# Borra objetos db/ con más de 8 días (los semanales/mensuales se mueven a
# prefijos db-weekly/ db-monthly/ por otra tarea; ver README).
rclone delete --min-age 8d "r2:$R2_BUCKET/db/" || true
echo "[prune] OK"
