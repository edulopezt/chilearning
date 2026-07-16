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
legítimo por sesión de alumno, ráfagas bajas) pero que corte una inundación. Ejemplo de labels en la
app `chilearning-staging` de Coolify (ajustar `average`/`burst` con datos del piloto):

```
traefik.http.middlewares.sence-cb-rl.ratelimit.average=30
traefik.http.middlewares.sence-cb-rl.ratelimit.period=1m
traefik.http.middlewares.sence-cb-rl.ratelimit.burst=15
traefik.http.middlewares.sence-cb-rl.ratelimit.sourcecriterion.ipstrategy.depth=1
# Router SOLO para /api/sence/cb (no tocar el resto de la app):
traefik.http.routers.sence-cb.rule=Host(`seminarea.chilearning.cl`) && PathPrefix(`/api/sence/cb`)
traefik.http.routers.sence-cb.middlewares=sence-cb-rl
```

> ⚠ **No** poner el rate-limit sobre toda la app (tumbaría cohortes tras NAT — la misma lección que
> el rate-limit por-usuario de las rutas start/close, 3.6). Limitar **solo** `PathPrefix(/api/sence/cb)`.
> El `depth=1` toma la IP real detrás del proxy; si Cloudflare está delante, ajustar la estrategia.
> Alternativa si Traefik no expone el middleware fácil en Coolify: Cloudflare Rate Limiting Rules
> sobre `*/api/sence/cb*`.

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

- **Config del edge:** 🔒 handoff a Edu (Coolify/Traefik o Cloudflare). No es código; no entra por CI.
- **Gate del checklist pre-producción:** `docs/sence/CHECKLIST-PREPRODUCCION.md` §1 lo referencia como
  requisito antes de 4.2.
