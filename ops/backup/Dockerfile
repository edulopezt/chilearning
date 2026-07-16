# Contenedor de backup (task 3.7). Se despliega en Coolify como "Scheduled Task"
# (cron 0 6 * * * UTC = 03:00 America/Santiago). Imagen mínima con las 3 tools.
FROM alpine:3.20
RUN apk add --no-cache postgresql16-client age rclone gzip tzdata coreutils
WORKDIR /ops
COPY backup.sh prune.sh ./
RUN chmod +x backup.sh prune.sh
# El comando lo fija la Scheduled Task de Coolify: `/ops/backup.sh`.
CMD ["/ops/backup.sh"]
