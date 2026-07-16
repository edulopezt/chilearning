# Rate-limit del callback SENCE en el edge (D-048/Q-03) — handoff de infra

> **Decisión:** D-048/H4-Q-03 (revisión adversarial H4). El receptor de callbacks
> `POST /api/sence/cb[/{nonce}]` es **público y sin rate-limit en la app POR DISEÑO**: I-1 exige
> **persistir SIEMPRE** el callback (perder uno = perder una asistencia con valor legal), así que
> limitar en la app violaría el invariante. Por eso el anti-DoS va en el **edge (Traefik/Coolify)**,
> no en el código. Este documento es el **handoff para Edu**: configurar el rate-limit + la alerta.

## Por qué hace falta

Cualquier POST con un `IdSesionAlumno` no vacío y ≤149 chars inserta una fila `unmatched` (tenant
NULL) en `sence_events`, que es **INSERT-only y no se puede podar**. Un bot que descubra la URL
podría inflarla. El gate M-4 ya descarta los POSTs sin `IdSesionAlumno` usable (y **registra cada
descarte**, D-048/Q-02: `[sence] callback descartado por M-4 …`), pero el límite de volumen debe
vivir en el proxy.

## Qué configurar (Traefik, vía labels de Coolify)

Aplicar un **middleware de rate-limit de Traefik SOLO a la ruta del callback**, generoso (un callback
legítimo por sesión de alumno, ráfagas bajas) pero que corte una inundación.

> **✅ APLICADO 2026-07-16 (staging).** La UI de Coolify 4.1.2 **NO expone editor de Custom Labels**
> (solo toggles en Advanced), así que se usó el mecanismo estándar de Traefik: un **archivo de
> configuración dinámica**. El Traefik de Coolify ya lo tiene habilitado
> (`--providers.file.directory=/traefik/dynamic/ --providers.file.watch=true`, montado desde
> `/data/coolify/proxy/dynamic/`). Ventaja sobre los labels: **persiste entre redeploys de la app** y
> no la toca; Traefik lo recarga solo (watch), sin redeploy; y un YAML mal formado **se ignora** (no
> rompe el routing). Verificado: ráfaga de 45 POST → mezcla de 303/429 (corta la inundación) y
> `/api/health` sigue 200 (el resto de la app intacto).

**Config-as-code:** [`ops/traefik/sence-cb-ratelimit.yaml`](../../ops/traefik/sence-cb-ratelimit.yaml)
(versionado en el repo). Desplegado en el VPS en `/data/coolify/proxy/dynamic/sence-cb-ratelimit.yaml`.

- **Re-desplegar / actualizar** (tras editar el YAML del repo): `scp` al VPS →
  `cp` a `/data/coolify/proxy/dynamic/` (Traefik lo recarga solo, sin redeploy de la app).
- **Rollback:** `rm /data/coolify/proxy/dynamic/sence-cb-ratelimit.yaml` en el VPS → vuelve al estado
  sin límite en segundos.
- **Ajustar el umbral** (`average`/`burst`) con datos del piloto editando el YAML y re-copiándolo.

> ⚠ **No** poner el rate-limit sobre toda la app (tumbaría cohortes tras NAT — la misma lección que
> el rate-limit por-usuario de las rutas start/close, 3.6). El router `sence-cb` matchea **solo**
> `PathPrefix(/api/sence/cb)` y Traefik le da prioridad automática sobre el catch-all `/`.

## Alerta de crecimiento anómalo de `unmatched`

Complemento al rate-limit (el follow-up ya anotado en `alerts.ts`): vigilar el ritmo de inserción de
eventos `unmatched`. Dos vías:

- **Rápida (ya disponible):** los descartes M-4 salen a los logs (`[sence] callback descartado por
  M-4`); un monitor de logs en Coolify/Uptime Kuma sobre ese patrón detecta ráfagas sin tocar código.
- **Completa (follow-up):** en el worker, extender el chequeo de tasa de error para emitir una alerta
  `alerts` (`kind='sence_unmatched_spike'`) cuando `count(unmatched en la ventana)` supere un umbral.
  Hoy los `unmatched` quedan FUERA del cálculo de tasa de error (tenant NULL) — es el follow-up
  documentado en `src/modules/sence/domain/alerts.ts`.

## Verificación

- Un `curl` en ráfaga a `https://seminarea.chilearning.cl/api/sence/cb/deadbeef` recibe `429` tras
  superar el umbral, mientras un callback legítimo (uno por sesión) nunca lo alcanza.
- El monitor sintético del callback (Uptime Kuma #3, `docs/observability/UPTIME-KUMA.md`) sigue verde
  (un POST puntual no gatilla el límite).

## Estado

- **Config del edge:** ✅ **APLICADA y VERIFICADA en staging (2026-07-16)** vía archivo dinámico de
  Traefik (`ops/traefik/sence-cb-ratelimit.yaml` → `/data/coolify/proxy/dynamic/` en el VPS). Persiste
  entre redeploys. Ajustar `average`/`burst` con datos reales del piloto.
- **Follow-up (opcional):** la alerta de spike de `unmatched` en el worker (arriba) queda como mejora.
- **Gate del checklist pre-producción:** `docs/sence/CHECKLIST-PREPRODUCCION.md` §1 lo referencia como
  requisito antes de 4.2 — **cumplido**.
