# RUNBOOK-ROTACION-SECRETOS.md — Rotar un secreto (compromiso o higiene)

> **Runbook operativo (Hito 4, tarea 4.3).** Cierra el hueco de RNF-8 (runbooks para *rotación de
> secretos*; los de restore e incidente ya existen). Úsalo si un secreto se filtró, si un
> colaborador deja de tener acceso, o como higiene periódica. Regla dura P6/P7: los secretos
> viven fuera del código (`.env.local` gitignored, secrets de Coolify, `STAGING-CREDENTIALS.txt`
> gitignored); **jamás** en un commit, log, fixture, captura ni en el chat.

## Regla general de rotación

1. **Generar** el nuevo secreto (comando en la tabla).
2. **Cargarlo** donde se consume (`.env.local` local, secrets de Coolify para app/worker/backup,
   panel del proveedor). Para variables `NEXT_PUBLIC_*` recordar que se **hornean en build** →
   requieren **rebuild** del contenedor, no solo restart.
3. **Redeploy** de los servicios afectados (app y/o worker) por el flujo normal de Coolify.
4. **Verificar** que todo sigue vivo (health `ok`, login, un tick del worker, según el secreto).
5. **Invalidar** el secreto viejo en el proveedor (revocar la key anterior) una vez confirmado el
   nuevo — no antes.
6. **Registrar** la rotación (fecha, motivo, secreto, quién) en `STAGING-CREDENTIALS.txt` y, si
   fue por compromiso, en `audit_log`/bitácora del piloto.

> **Nunca** rotar en caliente durante una sesión SENCE activa salvo compromiso real: un redeploy
> corta el servicio unos segundos. Preferir una ventana sin alumnos.

---

## Tabla de secretos

| Secreto | Dónde vive | Cómo se genera / rota | Radio de impacto (blast radius) | Quién |
|---|---|---|---|---|
| **`SENCE_TOKEN_ENCRYPTION_KEY`** | `.env.local`, secrets de app y worker en Coolify | `openssl rand -base64 32`. ⚠ **Caso especial** (ver abajo): rotarla deja los tokens OTEC ya cifrados **indescifrables**. | **Máximo**: sin la clave correcta, ningún `start`/`close` SENCE funciona (500). | **Edu** (P3) |
| **`SUPABASE_SERVICE_ROLE_KEY`** | secrets de app, worker y backup (`SUPABASE_DB_URL` aparte) | Supabase → Settings → API → *roll* de la service_role key | Alto: es la llave que salta RLS (worker + callbacks). Comprometida = acceso total a datos. | Edu |
| **`NEXT_PUBLIC_SUPABASE_ANON_KEY`** | build args del Dockerfile (horneada), `.env.local` | Supabase → Settings → API → *roll* de la anon/publishable key | Medio: es pública por diseño (va al navegador), pero rotarla exige **rebuild** de la app. | Edu |
| **`SUPABASE_ACCESS_TOKEN`** (CLI/Management API) | `.env.local` | https://supabase.com/dashboard/account/tokens → revocar y crear | Alto: administra el proyecto (migraciones por Management API). | Edu |
| **`SUPABASE_DB_PASSWORD` / `SUPABASE_DB_URL`** | secret del contenedor de backup en Coolify | Supabase → Settings → Database → reset password (regenera el connection string) | Alto: acceso directo a la BD (lo usa `pg_dump`). | Edu |
| **`RESEND_API_KEY`** | secrets de app y worker; SMTP de Kuma | resend.com → API Keys → revocar y crear | Bajo: comprometida = envío de correo a tu nombre. Sin ella, el correo degrada a no-op. | Edu/agente |
| **`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`** | secrets del contenedor de backup | Cloudflare → R2 → Manage R2 API Tokens → revocar y crear (scoped al bucket) | Medio: acceso a los backups cifrados (siguen protegidos por `age`). | Edu |
| **Par `age` (`AGE_PUBLIC_KEY` + privada)** | pública en secret de backup; **privada OFFLINE con Edu** | `age-keygen -o age-key.txt`. Rotar = re-cifrar backups futuros; los viejos siguen bajo la clave anterior (conservar ambas). | **Crítico**: perder la privada = backups irrecuperables. Nunca sube al VPS ni a Git. | **Edu** |
| **`COOLIFY_API_TOKEN`** | `.env.local` (solo por `localhost:8000` vía SSH) | Coolify → Keys & Tokens → revocar y crear | Alto: controla despliegues. El token lleva `\|` (base64-encodear al pasarlo por SSH). | Edu |
| **`CLOUDFLARE_API_TOKEN`** | `.env.local` (filtro de IP = VPS; se corre desde el VPS por SSH) | Cloudflare → My Profile → API Tokens → roll | Medio: DNS de `chilearning.cl`. | Edu |
| **`N8N_WEBHOOK_SECRET`** | secrets de app/worker y de n8n | `openssl rand -hex 32` (mismo valor en ambos lados) | Bajo: firma los webhooks a n8n (periférico). | Edu/agente |
| **`SENTRY_DSN` / `SENTRY_AUTH_TOKEN`** | secrets app/worker (DSN); CI (auth token) | Sentry → Settings → Client Keys (DSN) / Auth Tokens | Bajo: DSN es semipúblico; el auth token sube sourcemaps. | Edu/agente |
| **Claves demo de staging** (usuarios `*.test`) | `STAGING-CREDENTIALS.txt` (gitignored) | Reset por Management API SQL (`crypt`), NO por el admin API de GoTrue (rechaza la key nueva). | Bajo: son datos ficticios de staging. | Edu/agente |
| **`ANTHROPIC_API_KEY`, `BUNNY_*`, `WHATSAPP_*`** | `.env.local` / secrets (no activos hasta Hito 5) | consola del proveedor | Bajo hoy (no en uso). | Edu |

---

## Caso especial — `SENCE_TOKEN_ENCRYPTION_KEY`

Esta clave cifra en reposo el token de cada OTEC (AES-256-GCM, I-6). **Rotarla NO re-cifra los
tokens existentes**: los que ya están guardados quedan cifrados con la clave anterior y se vuelven
indescifrables → el próximo `start` SENCE da 500. Por eso:

- **No** se rota "por higiene" sin un plan. Solo se rota por **compromiso confirmado** de la clave.
- Procedimiento correcto ante compromiso (con Edu):
  1. Poner la clave nueva en la config (app + worker) **sin** desplegar aún.
  2. Cada OTEC afectado **reingresa su token** por `/admin/sence` → se re-cifra con la clave nueva.
     (En el piloto es un solo tenant: es un paso, no una migración.)
  3. Desplegar. Verificar un `start` en `rcetest`/`mock` antes de exponer a producción.
  4. Revocar/olvidar la clave vieja.
- **Nunca** se cambia esta clave "para probar" durante una sesión de asistencia real.

---

## Verificación post-rotación (según el secreto)

- **Cualquiera de app:** `GET /api/health` → `ok` + un login de prueba.
- **`SUPABASE_SERVICE_ROLE_KEY` / `REDIS_URL`:** los logs del worker muestran `[worker] arriba` y
  un `[worker][tick]` nuevo sin `error de conexión Redis`.
- **`SENCE_TOKEN_ENCRYPTION_KEY`:** un `start` SENCE en `mock`/`rcetest` completa sin 500.
- **R2 / `age`:** el contenedor de backup imprime `[backup] OK` y aparece un objeto nuevo en R2.
- **`RESEND_API_KEY`:** un correo de prueba (o la alerta de Kuma) llega.

Registrar la rotación en `STAGING-CREDENTIALS.txt` (fecha, secreto, motivo). Si fue por compromiso,
además anotar el incidente en la bitácora del piloto y evaluar si algo se filtró en el intervalo.
