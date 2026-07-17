# Guion de demo — Chilearning (15-20 minutos)

> Usa el tenant demo `demo` (OTEC Demo Chilearning), 100% ficticio, sembrado por
> `supabase/seed.sql` (task 5.7). Corre en local/staging con datos de mentira — **nunca
> reutilizar estas credenciales contra producción real.**

## A qué apunta esta demo

`specs/01-especificacion.md` §8 define los 4 criterios de éxito de la v1. El guion está
armado para que, al final, el prospecto haya visto los 4 en acción (con el matiz honesto de
cada uno, igual que en el one-pager):

1. *"Un curso e-learning asincrónico de franquicia (línea 3) ejecutado de punta a punta...
   inscripción → asistencia SENCE real → evaluaciones → encuesta → certificado → reporte
   listo para DJ, sin planillas externas."* → pasos 2 a 7 de abajo.
2. *"Cero incidentes de fuga de datos entre tenants (validado por tests y auditoría)."* →
   se narra en el paso 8 (portal del fiscalizador) y el paso 9 (portal empresa): ambos
   accesos están acotados por diseño, no por convención de la interfaz.
3. *"Restauración de backup ensayada con éxito al menos 2 veces antes del piloto real."* →
   no se demuestra en vivo (es un ejercicio de operaciones, no de producto); se puede
   mencionar de palabra si el prospecto pregunta por continuidad de servicio.
4. *"Un segundo tenant (OTEC externa) puede crearse y operar sin tocar código."* → paso 1
   (si el presentador tiene acceso superadmin) o se narra con el tablero de superadmin.

## Antes de empezar

- Entorno con el tenant `demo` sembrado (`supabase db reset` local, o el mismo seed aplicado
  en staging).
- Tener a mano la tabla de credenciales del final.
- Si se va a mostrar el tutor IA (paso opcional 10), confirmar ANTES de la reunión que el
  flag `ai_tutor` está activo para el tenant y que `OPENROUTER_API_KEY` está configurado — si
  no, se omite sin problema, el resto de la demo no depende de eso.

## Secuencia sugerida

### 1. (Opcional) Tablero de superadmin — 1 min
Login como `superadmin@chilearning.test` → `/superadmin/tenants`. Muestra la lista de OTECs
(tenants) de la plataforma y narra: *"cualquier OTEC nueva se crea acá, sin que nadie del
equipo de Chilearning toque código — es el criterio de éxito #4 de la spec"*. Vuelve a cerrar
sesión y sigue con el admin del tenant demo.

### 2. Login como admin de la OTEC + el curso — 2 min
Login como `admin@demo.test` → `/admin/cursos`. Abre **"Curso demo: Comunicación efectiva en
equipos de trabajo"** (`/admin/cursos/{courseId}/lecciones`): muestra las 5 lecciones de
texto ya publicadas, la modalidad e-learning y las horas del curso. Punto de venta: *"esto se
arma con el asistente de creación de cursos, desde cero o subiendo un descriptor .docx — no
hay que picar cada lección a mano si ya tienes el material"*.

### 3. Flujo del alumno + asistencia SENCE — 4 min
Abre una sesión aparte (o ventana privada) como `alumno@demo.test` → `/mi-curso`. Recorre una
lección y narra el registro de asistencia SENCE: *"acá el alumno confirma su identidad con
Clave Única y el sistema abre una sesión contra el protocolo RCE de SENCE — en este demo el
ambiente configurado es `rcetest` (el simulador oficial), porque la validación contra
producción real de SENCE se completa recién en el primer curso del cliente (ver el matiz del
one-pager)"*. Si el entorno lo permite, muestra el detalle de las sesiones SENCE cerradas del
alumno demo (`/admin/acciones/{actionId}/sesiones`): varios días con sesión abierta y cerrada,
sin errores — y un par de días sin sesión (para que el semáforo del panel del paso 7 se vea
realista, no un 100 % perfecto).

### 4. Evaluaciones y libro de notas — 3 min
Con el mismo curso, abre **Evaluaciones** (`/admin/cursos/{courseId}/evaluaciones`): el quiz
"Quiz demo: fundamentos de comunicación efectiva" con su intento enviado y nota 6.8, y la
tarea "Informe: plan de comunicación de mi equipo" con la entrega de Camila. Muestra el libro
de notas de la acción (`/tablero/notas` o el tablero del relator) con la nota consolidada.

### 5. Encuesta de satisfacción — 1 min
Abre la encuesta publicada del curso (`/admin/cursos/{courseId}/encuesta`) y muestra que ya
tiene una respuesta registrada (anónima por diseño: el staff ve el agregado, nunca quién
respondió qué). Punto de venta: *"la encuesta puede ser requisito de completitud del curso,
igual que las lecciones y el mínimo de asistencia"*.

### 6. Certificado + verificación pública — 3 min
Vuelve al admin y abre **Certificados** (`/admin/certificados` o
`/admin/acciones/{actionId}/certificados`): el certificado emitido de Camila Espinoza Leiva,
con folio `CERT-2026-000001` y su QR. Abre `/verificar/{token}` (o escanea el QR) en una
pestaña de incógnito, SIN sesión iniciada: *"cualquiera que reciba este certificado lo valida
acá, sin cuenta, y el RUN sale enmascarado — nunca se expone completo en una verificación
pública"*.

### 7. Panel de cumplimiento SENCE + DJ/GCA — 2 min
Abre `/admin/acciones/{actionId}/cumplimiento` (semáforo de asistencia/avance) y
`/admin/acciones/{actionId}/dj` (checklist de la declaración jurada y la GCA, con el plazo de
liquidación calculado). Punto de venta: *"esto es lo que hoy se arma la noche antes de la
fiscalización con una planilla — acá se va llenando solo mientras se dicta el curso"*. Si hay
tiempo, abre también `/admin/acciones/{actionId}/expediente` (documentos + checklist,
descargable en ZIP).

### 8. Portal del fiscalizador — 1 min
Login como `supervision@demo.test` → `/supervisor`. Muestra el acceso de solo lectura (sin
ningún botón de escritura) con alcance ya configurado sobre el tenant demo. Punto de venta,
criterio de éxito #2: *"SENCE, la OTIC o un auditor entran con esto — nunca con tu usuario de
admin — y cada consulta que hacen queda auditada"*.

### 9. Portal de la empresa cliente — 2 min
Login como `empresa@demo.test` (Comercial Andina SpA) → `/empresa`. Muestra que ve a sus dos
trabajadoras vinculadas (Camila y Matías) con su avance y certificado — y punto de venta
explícito sobre el criterio de éxito #2: *"si esta empresa fuera cliente de otra OTEC, o si
hubiera otra empresa en el mismo tenant, jamás vería a esos alumnos — el aislamiento está
aplicado en la base de datos, no solo escondido en la interfaz"*.

### 10. (Opcional) Tutor con IA — 2 min, SOLO si está activo
Si el flag `ai_tutor` está prendido y `OPENROUTER_API_KEY` cargada: entra como alumno y abre
el tutor dentro de una lección. Muestra el banner de transparencia (deja explícito que es una
IA, no una persona) y responde una pregunta simple sobre el contenido del curso. Si no está
disponible, se omite este paso sin explicarlo como una falla — simplemente no se menciona.

## Cierre

Vuelve al one-pager (`docs/venta/ONE-PAGER.md`) para el resumen de diferenciadores y el matiz
honesto sobre la certificación SENCE contra el ambiente real. Sin hablar de precios: eso se
conversa aparte.

## Credenciales demo

**SOLO para entornos dev/staging — jamás usar contra un tenant de producción real.**
Contraseña local de todos: `Password123!`.

| Rol | Correo | Para mostrar |
|---|---|---|
| Superadmin de plataforma | `superadmin@chilearning.test` | Tablero de todas las OTECs (paso 1, opcional) |
| OTEC admin (tenant demo) | `admin@demo.test` | Curso, evaluaciones, certificados, cumplimiento, DJ |
| Coordinador | `coordinacion@demo.test` | Gestión académica del tenant demo |
| Relator/instructor | `relator@demo.test` | Tablero del relator, respondió el hilo del foro |
| Tutor | `tutor@demo.test` | Seguimiento y mensajería con el alumno |
| Alumno (featured, recorrido completo) | `alumno@demo.test` (Camila Espinoza Leiva) | Lecciones, asistencia SENCE, quiz, tarea, encuesta, certificado |
| Empresa cliente | `empresa@demo.test` (Comercial Andina SpA) | Portal empresa: solo sus 2 trabajadoras |
| Supervisor/fiscalizador | `supervision@demo.test` | Portal de solo lectura, alcance tenant, sin expiración |
