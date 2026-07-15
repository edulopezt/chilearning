# Chilearning

LMS SaaS **multi-tenant** para OTECs chilenas con validación de asistencia **SENCE**
(protocolo RCE con Clave Única), panel de cumplimiento y certificados verificables.

## Documentación (leer en este orden)

0. **`specs/ESTADO-PROYECTO.md`** — tablero vivo: qué está hecho, qué falta, cómo retomar (empieza aquí)
1. `specs/00-constitucion.md` — los 10 principios innegociables
2. `specs/01-especificacion.md` — el QUÉ (módulos, roles, historias de usuario)
3. `specs/02-plan-tecnico.md` — el CÓMO (stack, arquitectura, ADRs)
4. `specs/03-tareas.md` — el plan de ejecución por hitos
5. `CLAUDE.md` — reglas operativas del día a día
6. `docs/sence/` — protocolo SENCE congelado contra el manual oficial

> `block_sence/` e `integracion-sence-portable/` son material de referencia AGPLv3
> de solo lectura — ver `NOTICE.md`. Prohibido importar código desde ahí.

## Requisitos

- Node ≥ 24, pnpm (`npm i -g pnpm`), Docker Desktop, Supabase CLI

## Comandos

| Comando | Qué hace |
|---|---|
| `pnpm dev` | App en desarrollo (requiere `supabase start`) |
| `pnpm lint` / `pnpm typecheck` | Calidad estática |
| `pnpm test` / `pnpm test:unit` | Tests unitarios (Vitest) |
| `pnpm test:rls` | Suite de aislamiento multi-tenant (requiere `supabase start`) |
| `pnpm test:integration` | Motor SENCE contra el mock (requiere `supabase start`) |
| `pnpm sence:mock` | Mock local del RCE de SENCE (puerto 4010) |
| `pnpm build` | Build de producción |

## Desarrollo local (paso a paso)

La app corre contra el **Supabase local** (no la nube). Sus claves las imprime
`supabase status` y son deterministas por máquina.

1. Herramientas: Node ≥ 24, `npm i -g pnpm`, Docker Desktop **encendido**, Supabase CLI.
2. `pnpm install`
3. `supabase start` (primera vez descarga imágenes) y luego `supabase db reset`
   (aplica migraciones + seeds: 2 OTECs × 8 roles + curso demo).
4. **`.env.local`**: copia `.env.example` y, para desarrollo local, apunta las
   variables de Supabase al stack LOCAL (⚠ no a un proyecto de la nube):
   ```bash
   supabase status   # copia API URL, anon key y service_role key
   ```
   Variables mínimas para levantar la app y el flujo SENCE en local:
   - `NEXT_PUBLIC_SUPABASE_URL` = API URL local (`http://127.0.0.1:54321`)
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY` = anon key local
   - `SUPABASE_SERVICE_ROLE_KEY` = service_role key local
   - `TENANT_ROOT_DOMAIN=localtest.me`
   - `SENCE_ENV=mock` y `SENCE_MOCK_URL=http://127.0.0.1:4010`
   - `SENCE_TOKEN_ENCRYPTION_KEY` = 32 bytes base64 (`openssl rand -base64 32`)
5. `pnpm dev` → http://localhost:3000. Login demo: `alumno@otec-andes.test`
   (o `admin@otec-andes.test`, `superadmin@chilearning.test`) / `Password123!`.
6. Para probar el flujo SENCE completo: en otra terminal `pnpm sence:mock`, y
   configura el token cifrado del OTEC demo (o hazlo desde el panel de admin
   cuando exista). El alumno verá el curso en `/mi-curso` con candado SENCE.

**Nunca** commitear `.env*` ni secretos. Guía detallada de producción en
`GUIA-CONFIGURAR-ENV.md`.

## Arquitectura (resumen)

Next.js (App Router) + TypeScript estricto, monolito modular
(`src/modules/{core,academico,contenido,sence,evaluacion,certificados,portal-empresa,comunicacion,reportes}`)
+ worker BullMQ. Supabase (Postgres con RLS en todas las tablas, Auth, Storage).
`src/modules/sence/` es sagrado: aislado y cubierto por tests contra el mock RCE local.
