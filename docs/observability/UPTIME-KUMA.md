# Uptime Kuma — monitoreo (task 3.7, Plan §10)

Uptime Kuma self-host en el VPS (Coolify) vigila los endpoints públicos y el
pipeline SENCE. Alertas → correo + Telegram (vía n8n, periférico).

## Monitores a crear (handoff a Edu — Kuma se auto-hospeda)
1. **App (health)** — HTTP(s) GET `https://otec-andes.chilearning.cl/api/health`,
   intervalo 60 s, keyword esperado `"ok"`. (El endpoint ya existe, task 3.7.)
2. **Landing** — HTTP(s) GET `https://otec-andes.chilearning.cl/` keyword del título.
3. **Callback SENCE sintético** — HTTP(s) **POST** a
   `https://otec-andes.chilearning.cl/api/sence/cb/deadbeef-nonce-inexistente`
   esperando una respuesta **rápida y bien formada** (redirect 303/4xx `unmatched`):
   prueba que el pipeline del callback + la correlación en BD están vivos **sin**
   tokens ni PII (el nonce no matchea ninguna sesión → no efecto).

## Instalación (resumen)
- Desplegar `louislam/uptime-kuma` en Coolify (imagen oficial), volumen para su BD.
- Configurar notificación (SMTP con `RESEND` o Telegram bot) y asociarla a los 3
  monitores.

Estado: endpoint `/api/health` **listo**; la instancia Kuma + los monitores =
handoff a Edu (self-host, sin costo de licencia).
