# Paquete SDD — "Chilearning"

LMS SaaS multi-tenant para OTECs en Chile con integración de asistencia SENCE.
Generado el 2026-07-13 a partir de la entrevista SDD (5 rondas) + material de `lms-marca/`.

| Documento | Fase SDD | Contenido |
|---|---|---|
| `00-constitucion.md` | Constitución | 10 principios innegociables (P1–P10) |
| `01-especificacion.md` | Specify + Clarify | Actores, matriz de permisos, 12 módulos (M1–M12) con historias y criterios de aceptación, RNFs, riesgos |
| `02-plan-tecnico.md` | Plan | Stack, arquitectura, multi-tenancy, motor SENCE, infraestructura, seguridad, 6 ADRs |
| `03-tareas.md` | Tasks | Hito 0 (sprint de esta semana) → Hito 5 (SaaS vendible), backlog v2, definición de hecho |
| `../CLAUDE.md` | Operación | Guía operativa para Claude Code: comandos, estilo, reglas duras, trampas SENCE |
| `../.env.example` | Configuración | Plantilla de variables de entorno, comentada y etiquetada por hito |
| `../INSTRUCCIONES-AGENTE.md` | Misión | Briefing end-to-end para el agente orquestador: fases con gates, subagentes, escalación a Edu |

## Cómo se usa (ciclo SDD)

1. La **constitución** gobierna todo; se cambia solo con decisión explícita registrada.
2. Antes de implementar cada módulo: escribir su **spec detallada** (deriva de `01`),
   clarificar dudas, planificar lo específico, y recién entonces codificar tarea por tarea.
3. Los tests se derivan de los criterios de aceptación, no del código.
4. Si la realidad contradice un documento: **primero se corrige el documento**, luego el código.

## Pendientes que desbloquean el Sprint 1 (ver `02` §13)

1. Diff manual SENCE v1.1.3 → v1.1.5/v1.1.6.
2. Consulta a controlelearning@sence.cl (API SIC en línea 3).
3. Nombre + dominio corto (límite 100 caracteres de UrlRetoma).
4. Verificar acceso a sistemas.sence.cl/rts (token) y rcetest con la cuenta del OTEC.
