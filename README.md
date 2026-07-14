# Chilearning

LMS SaaS **multi-tenant** para OTECs chilenas con validación de asistencia **SENCE**
(protocolo RCE con Clave Única), panel de cumplimiento y certificados verificables.

## Documentación (leer en este orden)

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
| `pnpm test` / `pnpm test:unit` | Tests (Vitest) |
| `pnpm build` | Build de producción |

Los scripts `test:rls`, `test:integration`, `test:e2e` y `sence:mock` nacen en sus
tareas correspondientes (ver `specs/03-tareas.md`).

## Entorno

Copia `.env.example` → `.env.local` y sigue `GUIA-CONFIGURAR-ENV.md`.
**Nunca** commitear `.env*` ni secretos.

## Arquitectura (resumen)

Next.js (App Router) + TypeScript estricto, monolito modular
(`src/modules/{core,academico,contenido,sence,evaluacion,certificados,portal-empresa,comunicacion,reportes}`)
+ worker BullMQ. Supabase (Postgres con RLS en todas las tablas, Auth, Storage).
`src/modules/sence/` es sagrado: aislado y cubierto por tests contra el mock RCE local.
