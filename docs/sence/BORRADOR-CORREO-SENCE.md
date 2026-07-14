# Borrador de correo a `controlelearning@sence.cl` (tarea 0.10)

> **Lo redacta Claude; lo envía Edu** (INSTRUCCIONES-AGENTE §5). Edu lo revisa, ajusta el tono
> y los datos de su OTEC, y lo manda desde su correo. Resuelve el riesgo **R2** de la
> especificación (obligatoriedad de la API LMS↔SIC para franquicia / línea 3) e incluye la
> pregunta abierta sobre la regla de duración de sesión (decisión **D-003**).

---

**Para:** controlelearning@sence.cl
**Asunto:** Consulta técnica — Integración plataforma propia (RCE) y API LMS-SIC para e-learning

Estimado equipo de Control e-learning de SENCE:

Junto con saludar, somos [**razón social del OTEC**, RUT **__________-_**], organismo técnico
de capacitación que actualmente registra asistencia e-learning mediante el protocolo RCE
(redirección con Clave Única). Estamos migrando a una plataforma propia y queremos asegurar el
cumplimiento normativo antes de operar con alumnos reales. Agradeceríamos su orientación en los
siguientes puntos:

1. **Obligatoriedad de la API de integración LMS ↔ SIC.** Hemos revisado el *Instructivo
   Técnico de Integración entre LMS y SIC (v2.0)* y el *Manual Integración Registro Asistencia
   (RCE) v1.1.6*. Quisiéramos confirmar: para cursos de **Franquicia Tributaria (línea de
   capacitación 3)** ejecutados en plataforma propia, ¿es **obligatoria** la integración vía la
   API LMS-SIC, o el registro de asistencia mediante el protocolo RCE (Clave Única) es
   suficiente? ¿Cambia esta exigencia para **Programas Sociales (línea 1)** o para otras líneas?

2. **Alcance de la API LMS-SIC.** En caso de ser exigible, ¿qué operaciones cubre (comunicación
   de participantes, sesiones, cierre, declaraciones juradas) y desde qué fecha/tipo de curso
   aplica? ¿Existe una versión del *Manual LMS-SIC* posterior a la v1.4 que debamos considerar?

3. **Duración de la sesión y tiempo de inactividad.** El manual RCE v1.1.6 recomienda mostrar
   un contador en pantalla, pero no especifica un límite normativo de duración de la sesión de
   asistencia ni un tiempo máximo de inactividad. ¿Existe una regla oficial (por ejemplo, 3
   horas de sesión o 60 minutos de inactividad) que debamos aplicar, y en qué documento se
   encuentra?

4. **Ambiente de certificación.** ¿Cuál es el procedimiento vigente para certificar una
   plataforma propia en el ambiente de pruebas (`rcetest`) antes de operar en producción?

Quedamos atentos a su respuesta. Agradecemos de antemano su apoyo.

Saludos cordiales,

[**Nombre**]
[**Cargo**] — [**Razón social del OTEC**]
[**Teléfono / correo de contacto**]

---

## Notas para Edu (no van en el correo)

- Verifica que el nombre de la línea 3 sea el vigente: en el manual **v1.1.6** aparece como
  **"Franquicia Tributaria"** (en v1.1.5 figuraba como "Impulsa Personas").
- La respuesta a la pregunta 3 cierra la decisión **D-003** (`specs/DECISIONES.md`): hoy el
  motor trata las 3 h / 60 min como **parámetros operativos configurables** por falta de fuente
  normativa en el manual RCE. Si SENCE confirma una regla oficial, se actualiza el contrato.
- La respuesta a la pregunta 1 cierra el riesgo **R2** de `specs/01-especificacion.md` y define
  si la API LMS-SIC entra en el alcance (hoy fuera del alcance del motor hasta activar línea 1/3
  con integración SIC — ver contrato §7).
