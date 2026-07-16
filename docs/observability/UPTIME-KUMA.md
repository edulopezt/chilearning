# Uptime Kuma — monitoreo (task 3.7, Plan §10)

Uptime Kuma self-host en el VPS (Coolify) vigila los endpoints públicos y el
pipeline SENCE. Alertas → correo + Telegram (vía n8n, periférico).

## Monitores (Kuma DESPLEGADO 2026-07-16 en Coolify; monitores 1-2 creados por Edu)

> **✅ D-046 RESUELTO (2026-07-16):** los 3 monitores apuntan a `seminarea.chilearning.cl` y están
> en verde (verificado por latido de Kuma + ground-truth de cada endpoint). El #3 usa nonce
> `kuma-monitor-nonce`, método POST, `Max. Redirects=0` y códigos aceptados `200-299` + `300-399`
> (para admitir el `303` del descarte M-4). Intervalo 300 s.
1. **App (health)** — HTTP(s) GET `https://seminarea.chilearning.cl/api/health`,
   intervalo 60 s, keyword esperado `"ok"`. (El endpoint ya existe, task 3.7.)
2. **Landing** — HTTP(s) GET `https://seminarea.chilearning.cl/` keyword del título.
3. **Callback SENCE sintético** — HTTP(s) **POST** a
   `https://seminarea.chilearning.cl/api/sence/cb/deadbeef-nonce-inexistente`
   esperando una respuesta **rápida y bien formada** (redirect 303/4xx `unmatched`):
   prueba que el pipeline del callback + la correlación en BD están vivos **sin**
   tokens ni PII (el nonce no matchea ninguna sesión → no efecto).

## Instalación (resumen)
- Desplegar `louislam/uptime-kuma` en Coolify (imagen oficial), volumen para su BD.
- Configurar notificación (SMTP con `RESEND` o Telegram bot) y asociarla a los 3
  monitores.

Estado: Kuma **desplegado** (service Coolify `qi5m1zfd…`) con los **3 monitores** (health, login,
callback SENCE sintético) apuntando a `seminarea` y **en verde** (2026-07-16). Alertas por correo
(Resend SMTP) funcionando. **Pendiente menor:** confirmar en vivo que el correo dispara al caer un
monitor (prueba controlada).
