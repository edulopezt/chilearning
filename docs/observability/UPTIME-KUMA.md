# Uptime Kuma — monitoreo (task 3.7, Plan §10)

Uptime Kuma self-host en el VPS (Coolify) vigila los endpoints públicos y el
pipeline SENCE. Alertas → correo + Telegram (vía n8n, periférico).

## Monitores (Kuma DESPLEGADO 2026-07-16 en Coolify; monitores 1-2 creados por Edu)

> **⚠ D-046:** los monitores vivos hoy apuntan a `otec-andes.chilearning.cl`. Al ejecutar el
> corte del rename hay que RE-APUNTARLOS a `seminarea.chilearning.cl` (editar la URL en la UI
> de Kuma) o quedarán vigilando el dominio viejo (falsa alarma o monitoreo muerto).
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

Estado: Kuma **desplegado** (service Coolify `qi5m1zfd…`) con monitores health+login y
alertas por correo (Resend SMTP) **funcionando**. Pendiente: monitor sintético del callback
SENCE (#3) y re-apuntar URLs tras el corte D-046.
