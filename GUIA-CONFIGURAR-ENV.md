# Guía: cómo llenar el `.env.local` de Chilearning

> Esta guía te lleva, servicio por servicio, a buscar cada valor que pide `.env.example` y
> pegarlo en tu `.env.local`. No necesitas saber programar para seguirla: son clics y copiar-pegar.
>
> **Regla de oro, siempre:** ningún valor real de esta guía se comparte en un chat (ni conmigo,
> ni con nadie) ni se sube a GitHub. Vive solo en tu `.env.local` (tu computador) y, más adelante,
> en el panel de secretos de Coolify (tu servidor). Si algún día un valor se filtra, se "rota"
> (se genera uno nuevo en el mismo panel donde lo creaste) y se reemplaza.
>
> Formato de cada sección: **Qué es** (en simple) → **A dónde ir** → **Pasos** → **Qué copiar a
> qué variable** → **Ojo con esto** (el error típico).

---

## Antes de empezar

1. Verifica que ya tengas el archivo `.env.local` (si no, créalo copiando `.env.example` —
   ver la explicación que te di antes: `copy .env.example .env.local` en PowerShell, o
   copiar+pegar+renombrar en el Explorador de Windows).
2. Ábrelo con el Bloc de notas o VS Code. Vas a ir reemplazando los `CAMBIAME` uno por uno.
3. Trabaja en el orden de esta guía: **Hito 0 primero** (es lo único que necesitas para arrancar
   esta semana). Todo lo demás puede esperar — no te compliques con Bunny Stream o WhatsApp hoy.

**Nota sobre el VPS:** las credenciales de tu VPS (V2Networks) NO van en este archivo. Se usan
una sola vez para instalar Coolify por SSH (tarea 0.3), y desde ahí Coolify administra sus
propios secretos en su panel web — es un lugar distinto, no este `.env.local`.

**Nota para más adelante:** cuando despleguemos a staging/producción, estos mismos valores
(algunos apuntando a proyectos distintos de prod) se pegan en el panel de "Environment
Variables" de cada aplicación dentro de Coolify — no se sube el archivo `.env.local` a ningún lado.

---

## 🟢 HITO 0 — lo que necesitas AHORA (≈15 minutos)

### 1. Supabase (base de datos)

**Qué es:** tu base de datos y sistema de login, ya la tienes creada.

**A dónde ir:** [supabase.com/dashboard](https://supabase.com/dashboard) → entra con tu cuenta →
selecciona tu proyecto.

**Pasos:**
1. En el menú izquierdo, ve a **Settings** (el engranaje, abajo) → **API Keys**.
2. Vas a ver dos llaves. **Ojo:** Supabase está renombrando sus llaves — dependiendo de cuándo
   creaste el proyecto, las vas a ver con nombre viejo o nuevo (son equivalentes, usa la que
   te aparezca):
   - La llave "pública": antes se llamaba **`anon`**, ahora puede aparecer como
     **`publishable`** (empieza con `sb_publishable_...`). Es segura de exponer.
   - La llave "secreta": antes se llamaba **`service_role`**, ahora puede aparecer como
     **`secret`** (empieza con `sb_secret_...`). ⚠️ Esta es poderosa: salta todas las
     protecciones de seguridad. Trátala como la llave de tu casa.
3. En la misma página (o en **Settings → General**), copia la **Project URL** y el
   **Reference ID** (el código corto que también aparece en la URL de tu navegador cuando
   estás dentro del proyecto, algo como `abcdefghijklmnop`).
4. Ve a [supabase.com/dashboard/account/tokens](https://supabase.com/dashboard/account/tokens)
   → **Generate new token** → dale un nombre como "faro-lms-cli" → cópialo (solo se muestra una vez).
5. La contraseña de base de datos (`SUPABASE_DB_PASSWORD`) es la que TÚ definiste cuando creaste
   el proyecto. Si no la recuerdas, en **Settings → Database** hay un botón para resetearla
   (genera una nueva y esa pasa a ser la definitiva — actualízala también aquí).

**Qué copiar a qué variable:**

| Lo que copiaste | Variable en `.env.local` |
|---|---|
| Project URL | `NEXT_PUBLIC_SUPABASE_URL` |
| Llave pública (`anon` / `publishable`) | `NEXT_PUBLIC_SUPABASE_ANON_KEY` |
| Llave secreta (`service_role` / `secret`) | `SUPABASE_SERVICE_ROLE_KEY` |
| Reference ID | `SUPABASE_PROJECT_REF` |
| Token que generaste en Account → Tokens | `SUPABASE_ACCESS_TOKEN` |
| Tu contraseña de base de datos | `SUPABASE_DB_PASSWORD` |

**Ojo con esto:** la llave secreta JAMÁS lleva el prefijo `NEXT_PUBLIC_` — si alguna vez ves una
variable con datos sensibles que empieza así, algo está mal, porque ese prefijo significa
"visible para cualquiera que abra la página en su navegador".

### 2. Clave de cifrado de tokens SENCE

**Qué es:** una clave que la propia plataforma genera (no un panel externo). Con ella se cifra
el token SENCE de cada OTEC en la base de datos.

**Pasos (elige el que tengas a mano):**
- Si tienes Git instalado en Windows (trae "Git Bash"): ábrelo y escribe:
  ```
  openssl rand -base64 32
  ```
- Si prefieres PowerShell (ya lo tienes, sin instalar nada; compatible con PowerShell 5 y 7):
  ```powershell
  $b = New-Object byte[] 32; [Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($b); [Convert]::ToBase64String($b)
  ```
  ⚠️ Si el resultado es una cadena de puras "A" (`AAAA...=`), algo falló: NO la uses y repite el comando.
- Cuando exista el repo, también puedo generarla yo mismo por ti con una tarea del Hito 0.

**Qué copiar a qué variable:** el resultado → `SENCE_TOKEN_ENCRYPTION_KEY`.

**Ojo con esto:** generas esta clave UNA vez por entorno (una para desarrollo, otra distinta
para producción) y nunca la cambias después salvo rotación deliberada — cambiarla sin más
"perdería la llave" de todos los tokens SENCE ya guardados.

### 3. Lo que NO necesitas tocar hoy

- `REDIS_URL`: ya viene lista para desarrollo local (Docker la levanta sola en la tarea 0.1).
- `SENCE_ENV=mock` y `SENCE_MOCK_URL`: ya están correctos, no los toques hasta el piloto real.
- `SEED_SUPERADMIN_EMAIL`: ya está con tu correo.
- Todo lo que diga `[H1]`, `[H3]` o `[H5]`: se llena más adelante, cuando lleguemos a ese hito.
  Déjalo vacío o con `CAMBIAME`, no rompe nada.

---

## 🟡 HITO 1 — cuando lleguemos a correos transaccionales

### Resend (envío de correos)

**Qué es:** el servicio que manda los correos automáticos (bienvenida, invitaciones, alertas).

**A dónde ir:** [resend.com](https://resend.com) → crear cuenta gratis.

**Pasos:**
1. **API Keys** (menú izquierdo) → **Create API Key** → nombre "faro-lms" → permiso "Sending access".
2. Cópiala AL TIRO — como la de Supabase, solo se muestra una vez.
3. **Domains** → **Add Domain** → tu dominio definitivo (cuando lo tengas) → Resend te da
   registros DNS (tipo TXT/MX) para pegar en Cloudflare; sin esto los correos pueden caer en spam.

**Qué copiar a qué variable:** la API key → `RESEND_API_KEY`. El remitente que definas
(ej. `no-responder@tudominio.cl`) → `MAIL_FROM`.

**Ojo con esto:** mientras no verifiques el dominio, Resend solo te deja enviar a tu propio
correo de prueba — normal, es la fase de pruebas.

---

## 🟠 HITO 3 — video, errores, backups, automatización

### Bunny Stream (video)

**Qué es:** donde vive el video de los cursos (nunca en tu VPS).

**A dónde ir:** [bunny.net](https://bunny.net) → crear cuenta → **Stream**.

**Pasos:**
1. **Add Video Library** → dale un nombre → creala.
2. Entra a la librería: el **Library ID** aparece en la URL del panel y también en su pantalla
   de resumen.
3. Dentro de la librería, busca la sección de API/seguridad para copiar la **API Key** de ESA
   librería (no la de tu cuenta general).
4. El **CDN Hostname** (algo como `vz-xxxxxx.b-cdn.net`) aparece en la pestaña de reproductor/CDN
   de la misma librería.

**Qué copiar a qué variable:** `BUNNY_STREAM_LIBRARY_ID`, `BUNNY_STREAM_API_KEY`,
`BUNNY_STREAM_CDN_HOSTNAME`.

**Ojo con esto:** Bunny tiene una API key "de cuenta" y otra "de librería de video" — son
distintas; la que necesitamos es la de la librería.

### Sentry (avisos de errores)

**Qué es:** te avisa cuando algo se rompe en la app, con el detalle técnico.

**A dónde ir:** [sentry.io](https://sentry.io) → crear cuenta gratis → **Create Project** →
elige plataforma "Next.js".

**Pasos:** al crear el proyecto, Sentry te muestra un **DSN** (una URL larga) en pantalla —
cópialo. Si lo pierdes, está en **Settings → Projects → [tu proyecto] → Client Keys (DSN)**.

**Qué copiar a qué variable:** `SENTRY_DSN`. (El `SENTRY_AUTH_TOKEN` solo se necesita en CI/GitHub
más adelante, no en tu `.env.local` — te aviso cuando toque.)

### Cloudflare R2 (backups fuera del VPS)

**Qué es:** almacenamiento barato donde se guardan copias de seguridad diarias, lejos del VPS
(si el VPS falla, el backup sigue existiendo en otro lugar).

**A dónde ir:** dashboard de Cloudflare → **R2 Object Storage**.

**Pasos:**
1. Si no tienes un bucket, créalo (nombre sugerido: `faro-backups`, coincide con el `.env.example`).
2. En la página de R2, sección **Account Details** → junto a **API Tokens** → **Manage** →
   **Create API Token**.
3. Elige tipo **User API Token**, permiso **Object Read & Write**, y limítalo a tu bucket
   `faro-backups`.
4. Al crear el token verás de una sola vez: **Access Key ID**, **Secret Access Key** y el
   **Account ID** (o el endpoint completo `https://<ACCOUNT_ID>.r2.cloudflarestorage.com`).
   Cópialos los tres ahora — el Secret Access Key no se vuelve a mostrar.

**Qué copiar a qué variable:** `R2_ACCOUNT_ID`, `R2_ACCESS_KEY_ID`, `R2_SECRET_ACCESS_KEY`,
`R2_BUCKET` (el nombre que le pusiste).

**Ojo con esto:** si cierras esa pantalla sin copiar el Secret Access Key, no hay forma de
recuperarlo — hay que borrar el token y crear uno nuevo. No pasa nada grave, solo repite el paso.

### n8n (webhook interno)

**Qué es:** no es un panel externo — es un secreto que TÚ inventas para que tu app y tu n8n
(ambos corriendo en tu VPS) se reconozcan entre sí.

**Pasos:** genera otro valor igual que hiciste con la clave de cifrado SENCE
(`openssl rand -hex 32` o el equivalente en PowerShell). El `N8N_WEBHOOK_URL` te lo dará Coolify
cuando despleguemos n8n ahí (tarea del Hito 3) — hoy puedes dejarlo vacío.

**Qué copiar a qué variable:** el valor generado → `N8N_WEBHOOK_SECRET`.

---

## 🔴 HITO 5 — WhatsApp e IA (lo último, no ahora)

### WhatsApp (Meta Cloud API)

**Qué es:** para mandar recordatorios por WhatsApp además de correo.

**A dónde ir:** [developers.facebook.com](https://developers.facebook.com) → crear una App tipo
"Business" → agregar el producto **WhatsApp**.

**Pasos (resumen; lo retomamos con calma en el Hito 3-5 porque el trámite de verificación de
Meta Business toma días o semanas, así que conviene iniciarlo con anticipación):**
1. En el panel de WhatsApp de tu app, copia el **Phone Number ID** de prueba.
2. Genera un **Access Token** (el temporal dura 24 h; para producción se necesita uno
   permanente, que exige verificar el negocio ante Meta).

**Qué copiar a qué variable:** `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_ACCESS_TOKEN`.

**Ojo con esto:** no vale la pena configurar esto hoy — el token temporal expira solo y hay que
volver a generarlo. Espera a la tarea correspondiente del Hito 3/5.

### Anthropic (Tutor IA + automatizaciones IA)

**Qué es:** la llave para que la plataforma use IA (tutor de estudio, resúmenes, etc.) — no se
usa antes del Hito 5, así que tampoco es urgente.

**A dónde ir:** [console.anthropic.com](https://console.anthropic.com) → **API Keys** →
**Create Key**.

**Qué copiar a qué variable:** `ANTHROPIC_API_KEY`.

---

## ✅ Checklist rápido (marca lo que ya tienes)

- [ ] `.env.local` creado a partir de `.env.example`
- [ ] Supabase: URL, llave pública, llave secreta, project ref, access token, contraseña de BD
- [ ] Clave de cifrado SENCE generada
- [ ] *(Hito 1)* Resend: API key + dominio verificado
- [ ] *(Hito 3)* Bunny Stream: library ID, API key, CDN hostname
- [ ] *(Hito 3)* Sentry: DSN
- [ ] *(Hito 3)* Cloudflare R2: access key, secret, account id, bucket
- [ ] *(Hito 3)* Secreto de webhook de n8n generado
- [ ] *(Hito 5)* WhatsApp: phone number id + token
- [ ] *(Hito 5)* Anthropic: API key

## Si algo sale mal

- **"Falta una variable de entorno" al correr la app:** revisa que la línea exista en
  `.env.local` y no tenga espacios raros alrededor del `=`.
- **Pegaste un valor en el chat sin querer:** avísame, y ve inmediatamente al panel de ese
  servicio a "rotar" o regenerar esa llave — no importa cuál, tómalo como comprometida y listo.
- **Perdiste un valor que ya no se puede volver a ver** (service_role, R2 secret, etc.):
  no hay drama, se genera uno nuevo en el mismo panel y se reemplaza en `.env.local`.
