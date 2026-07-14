# CLAUDE.md

> Guía operativa para Claude Code en este repositorio. Mantener este archivo CORTO — cada
> línea consume contexto en cada sesión. La fuente de verdad del producto vive en `/specs`;
> aquí solo va lo necesario para trabajar bien el día a día. Actualízalo cuando cambien
> comandos, convenciones o reglas (y solo entonces).

## Proyecto

LMS SaaS **multi-tenant** para OTECs chilenas con validación de asistencia **SENCE**
(protocolo RCE con Clave Única). Lo desarrolla una sola persona (Edu) con IA como copiloto.
Nombre del producto: "Chilearning".

Lectura obligatoria antes de implementar (en este orden):
`specs/00-constitucion.md` → `specs/01-especificacion.md` → `specs/02-plan-tecnico.md` → `specs/03-tareas.md`.
Protocolo SENCE: `docs/sence/SPEC_INTEGRACION_SENCE.md` + manual oficial vigente (v1.1.5+).

## Flujo de trabajo (SDD — innegociable)

1. Toda tarea nace de `specs/03-tareas.md` y referencia una HU de `specs/01-especificacion.md`.
2. **Spec primero**: si la implementación contradice el spec, DETENTE y propone el cambio al
   documento; Edu aprueba antes de escribir código (principio P1).
3. Los tests se derivan de los criterios de aceptación (CA) de la HU — idealmente antes del código.
4. Nada llega a `main` sin CI verde. NUNCA editar nada directamente en el servidor (P6).

## Stack y arquitectura (resumen — detalle en specs/02)

- Next.js (App Router) + TypeScript estricto. Monolito modular + worker BullMQ (Redis).
- Supabase Cloud: Postgres con **RLS en TODAS las tablas**, Auth (JWT con claims de tenant/roles), Storage.
- Migraciones SQL versionadas con Supabase CLI. Acceso a datos con supabase-js bajo RLS;
  el cliente service-role SOLO en worker y callbacks SENCE, SIEMPRE a través de `tenantGuard()`.
- Módulos: `src/modules/{core,academico,contenido,sence,evaluacion,certificados,portal-empresa,comunicacion,reportes}`.
- `src/modules/sence/` es SAGRADO: aislado, sin dependencias hacia el resto, cubierto por tests
  contra el mock RCE local.
- Video SIEMPRE vía Bunny Stream (nunca servido desde el VPS). Deploy con Coolify: staging → prod.

## Comandos

Gestor: pnpm. Si un script aún no existe, créalo en la tarea que corresponda y regístralo aquí.

- `pnpm dev` — app en desarrollo (requiere `supabase start` local)
- `pnpm test` / `pnpm test:unit` / `pnpm test:integration` — Vitest
  - un solo archivo: `pnpm vitest run src/modules/sence/engine.test.ts`
- `pnpm test:rls` — suite de aislamiento multi-tenant (OBLIGATORIA si tocaste esquema o policies)
- `pnpm test:e2e` — Playwright
- `pnpm lint` / `pnpm typecheck`
- `pnpm sence:mock` — mock local del RCE de SENCE (puerto 4010)
- `supabase db reset` — recrea la BD local con migraciones + seeds (2 tenants × 8 roles)
- `supabase migration new <nombre>` — nueva migración SQL

Entorno: copia `.env.example` → `.env.local`. NUNCA commitear archivos `.env` ni secretos.

## Reglas duras (violarlas = PR rechazado)

- **Multi-tenant:** toda tabla de negocio lleva `tenant_id` + política RLS. Ninguna query cruza
  tenants. Prohibido saltarse `tenantGuard()` con el service role.
- **SENCE:** el token del OTEC jamás aparece en logs, respuestas al cliente ni fixtures; va
  cifrado en reposo (AES-256-GCM). Las tablas `sence_events` y `audit_log` son INSERT-only.
  Cualquier cambio al contrato SENCE exige diff contra el manual oficial + checklist en
  `rcetest` antes del release.
- **n8n:** solo automatización periférica (correos, recordatorios, alertas). PROHIBIDO poner
  lógica SENCE o de negocio crítica ahí (P3, ADR-004).
- **IA:** interactiva dentro de la app; por lotes en n8n solo con datos seudonimizados.
  Al modelo NUNCA van RUN, apellidos, correo, empresa ni datos SENCE (RNF-10).
- **Datos personales (Ley 21.719):** minimización; el RUN solo donde el spec lo exige;
  toda acción sensible escribe en `audit_log`.
- Validación con Zod en todo borde: requests, callbacks SENCE, imports CSV/Excel.

## Estilo de código

- Código, identificadores y commits en **inglés**; textos de UI y correos en **español de
  Chile**, centralizados en `src/i18n/es-CL.ts` (no strings sueltos en componentes).
- TS `strict`; prohibido `any` (usa `unknown` y narrowing). Server Components por defecto;
  `"use client"` solo con justificación.
- Lógica de dominio pura (testeable sin IO) en `src/modules/*/domain/`; UI compartida en `src/components/`.
- Los errores SENCE se traducen SIEMPRE con la tabla de `src/modules/sence/errors.ts`
  (códigos 100–310); nunca mostrar códigos crudos al alumno.
- UI 100% responsiva (RNF-6): Tailwind mobile-first; toda vista nueva se verifica en 360 px y
  1440 px; sin scroll horizontal; tablas colapsan a tarjetas en móvil; touch targets ≥ 44 px.
- Conventional Commits (`feat:`, `fix:`, `docs:`…). Ramas: `feat/h<hito>-<tarea>-<descripcion>`
  (ej. `feat/h0-0.7-sence-engine`). PRs pequeños, un objetivo por PR.

## Al terminar cualquier tarea

1. `pnpm lint && pnpm typecheck && pnpm test` en verde.
2. Si tocaste esquema o policies: `pnpm test:rls` en verde.
3. Si tocaste `src/modules/sence/`: suite de integración contra el mock + anotar el cambio
   en `docs/sence/CHANGELOG.md`.
4. Marca la tarea en `specs/03-tareas.md` y actualiza el runbook si cambió la operación.

## NO hacer

- No agregar dependencias significativas sin registrar un ADR en `specs/02-plan-tecnico.md` §12.
- No "arreglar" tests de RLS debilitándolos.
- No tocar producción a mano ni correr migraciones fuera del pipeline.
- No usar datos reales de alumnos en fixtures o tests (usa el generador de datos ficticios).
- No construir features que no existan en el spec — propón primero el cambio de spec.

## Contexto SENCE mínimo (trampas conocidas)

- Quirk de nombres del protocolo: `CodSence` = código del CURSO (10 dígitos);
  `CodigoCurso` = código de la ACCIÓN. No los inviertas.
- Línea 1 (Programas Sociales): `CodSence` va VACÍO y el código de acción usa formato SIC.
- `UrlRetoma`/`UrlError`: máximo 100 caracteres — cuidado al construir URLs por tenant.
- Ambientes `rcetest` (pruebas) y `rce` (producción): configurables POR ACCIÓN; jamás hardcodear.
- Callback sin `GlosaError` y sin `IdSesionSence` = cierre de sesión. `GlosaError` puede traer
  varios códigos separados por `;`. Sesión SENCE dura máx. 3 h; inactividad de app: 60 min.
