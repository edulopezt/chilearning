# Contenedor de backup (task 3.7). App long-running en Coolify: corre `crond` en
# foreground con el cron diario (06:00 UTC = 03:00/02:00 America/Santiago) y la
# poda semanal. Al arrancar hace un backup INICIAL de validación (no tumba el
# contenedor si falla: queda ruidoso en el log para que el operador lo vea).
#
# alpine 3.22 + postgresql17-client: la BD de Supabase corre PG 17 — un pg_dump
# v16 la rechaza ("server version mismatch").
FROM alpine:3.22
RUN apk add --no-cache postgresql17-client age rclone gzip tzdata coreutils
WORKDIR /ops
COPY r2-env.sh backup.sh prune.sh ./
RUN chmod +x backup.sh prune.sh \
  && echo "0 6 * * * /ops/backup.sh >> /proc/1/fd/1 2>&1" > /etc/crontabs/root \
  && echo "0 7 * * 0 /ops/prune.sh >> /proc/1/fd/1 2>&1" >> /etc/crontabs/root
CMD ["sh", "-c", "echo '[backup] contenedor arriba; backup inicial de validación...'; /ops/backup.sh || echo '[backup] ADVERTENCIA: el backup inicial FALLO (revisar credenciales/env)'; exec crond -f -l 8"]
