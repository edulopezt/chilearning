# Referencia Node/Express — Integración Asistencia SENCE

Implementación mínima y **runnable** del protocolo SENCE (RCE), portada del plugin Moodle
`block_sence`. Independiente de Moodle: sirve como base para una plataforma propia.
Lee el protocolo completo en `../SPEC_INTEGRACION_SENCE.md`.

## Requisitos
- Node.js 18+.
- Un **Token de OTEC** (genéralo en https://sistemas.sence.cl/rts).
- Para probar de verdad: usar el **ambiente `test`** y una **URL pública** para el callback
  (en local, exponla con [ngrok](https://ngrok.com): `ngrok http 3000`).

## Instalar y correr
```bash
cd referencia-node
npm install
# Configura por variables de entorno (o edita CFG en server.js):
#   PowerShell:  $env:SENCE_TOKEN="tu-token"; $env:SENCE_ENV="test"; $env:BASE_URL="https://xxxx.ngrok.io"; npm start
#   bash:        SENCE_TOKEN=tu-token SENCE_ENV=test BASE_URL=https://xxxx.ngrok.io npm start
npm start
```
Abre http://localhost:3000

## Rutas
| Ruta | Qué hace |
|---|---|
| `GET /` | Lista las asistencias guardadas + link de prueba. |
| `GET /sence/iniciar?run=11111111-1&codSence=1238043868&codAccion=123456&linea=3` | Muestra el botón que POSTea a SENCE (IniciarSesion). |
| `POST /sence/callback` | Recibe la respuesta de SENCE (éxito / error / cierre) y la guarda. |
| `GET /sence/cerrar?idSesionAlumno=...` | Botón para cerrar sesión (CerrarSesion). |

## Variables de entorno
| Var | Default | Descripción |
|---|---|---|
| `PORT` | 3000 | Puerto local |
| `BASE_URL` | http://localhost:3000 | URL **accesible por el navegador del alumno** (callback) |
| `RUT_OTEC` | 76668428-9 | RUT del OTEC |
| `SENCE_TOKEN` | (placeholder) | Token del OTEC |
| `SENCE_ENV` | test | `test` o `prod` |

## Importante / limitaciones
- Es una **demo**: guarda en memoria. En producción usa una BD real (ver modelo en el SPEC §8).
- El `BASE_URL` (UrlRetoma/UrlError) debe ser **absoluto y alcanzable**; con `localhost` SENCE no
  podrá redirigir de vuelta — usa ngrok o un dominio público.
- **No** valida el DV del RUN ni el formato del código de curso (agrégalo según el manual).
- Confirma nombres de campos y comportamiento contra el **Manual oficial SENCE v1.1.3** y prueba
  siempre primero en `rcetest`. Este código no fue verificado contra el servicio real de SENCE.
