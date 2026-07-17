-- =============================================================================
-- Seeds de desarrollo (task 0.2): 2 tenants × 8 roles, datos 100% FICTICIOS.
-- Regla dura: JAMÁS datos reales de personas en seeds/fixtures.
-- UUIDs deterministas para que la suite RLS los referencie.
-- Password local de todos los usuarios: 'Password123!' (solo dev).
-- =============================================================================

insert into public.tenants (id, slug, name, rut, plan, status) values
  ('11111111-1111-4111-8111-111111111111', 'seminarea',    'Seminarea SpA',     '76111111-6', 'standard', 'active'),
  ('22222222-2222-4222-8222-222222222222', 'otec-pacifico', 'OTEC Demo Pacífico Ltda', '76222222-1', 'standard', 'active');

-- ---------- Usuarios ficticios (auth.users) ----------
-- 1 superadmin de plataforma + 7 roles por tenant (el rol superadmin no es
-- por-tenant: viaja en el claim del JWT, sin membership).
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  u.id::uuid,
  'authenticated',
  'authenticated',
  u.email,
  extensions.crypt('Password123!', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
from (values
  ('00000000-0000-4000-8000-00000000000a', 'superadmin@chilearning.test'),
  -- Tenant A: Seminarea
  ('aaaaaaaa-0000-4000-8000-000000000001', 'admin@seminarea.test'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'coordinacion@seminarea.test'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'relator@seminarea.test'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'tutor@seminarea.test'),
  ('aaaaaaaa-0000-4000-8000-000000000005', 'alumno@seminarea.test'),
  ('aaaaaaaa-0000-4000-8000-000000000006', 'empresa@seminarea.test'),
  ('aaaaaaaa-0000-4000-8000-000000000007', 'supervision@seminarea.test'),
  -- Alumnos extra del tenant A que dan SUSTANCIA al escopado de la task 5.2:
  -- uno PARTICULAR (sin empresa) y uno de OTRA empresa del MISMO tenant. La
  -- empresa demo no debe ver a ninguno de los dos, aunque compartan acción con
  -- su trabajadora (CA HU-8.1: "jamás ve alumnos de otras empresas").
  ('aaaaaaaa-0000-4000-8000-000000000008', 'alumno-particular@seminarea.test'),
  ('aaaaaaaa-0000-4000-8000-000000000009', 'alumno-vulcano@seminarea.test'),
  -- Tenant B: OTEC Demo Pacífico
  ('bbbbbbbb-0000-4000-8000-000000000001', 'admin@otec-pacifico.test'),
  ('bbbbbbbb-0000-4000-8000-000000000002', 'coordinacion@otec-pacifico.test'),
  ('bbbbbbbb-0000-4000-8000-000000000003', 'relator@otec-pacifico.test'),
  ('bbbbbbbb-0000-4000-8000-000000000004', 'tutor@otec-pacifico.test'),
  ('bbbbbbbb-0000-4000-8000-000000000005', 'alumno@otec-pacifico.test'),
  ('bbbbbbbb-0000-4000-8000-000000000006', 'empresa@otec-pacifico.test'),
  ('bbbbbbbb-0000-4000-8000-000000000007', 'supervision@otec-pacifico.test')
) as u(id, email);

-- ---------- Memberships (7 roles por tenant) ----------
insert into public.memberships (tenant_id, user_id, roles, status)
select t.id::uuid, m.user_id::uuid, m.roles::public.role_key[], 'active'
from (values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', '{otec_admin}'),
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000002', '{coordinator}'),
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000003', '{instructor}'),
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000004', '{tutor}'),
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000005', '{student}'),
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000006', '{company}'),
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000007', '{supervisor}'),
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000008', '{student}'),
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000009', '{student}'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-0000-4000-8000-000000000001', '{otec_admin}'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-0000-4000-8000-000000000002', '{coordinator}'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-0000-4000-8000-000000000003', '{instructor}'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-0000-4000-8000-000000000004', '{tutor}'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-0000-4000-8000-000000000005', '{student}'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-0000-4000-8000-000000000006', '{company}'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-0000-4000-8000-000000000007', '{supervisor}')
) as m(tenant_id, user_id, roles)
join public.tenants t on t.id = m.tenant_id::uuid;

-- ---------- Grants de supervisor (task 3.11) ----------
-- Los supervisores semilla conservan acceso tenant-wide (sin expiración). El
-- backfill de la migración NO los ve porque el seed corre DESPUÉS de migrar; por
-- eso se crean aquí. Refleja el estado post-backfill de un tenant en producción.
insert into public.supervisor_grants (tenant_id, user_id, email, scope) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000007', 'supervisor-a@demo.chilearning.cl', 'tenant'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-0000-4000-8000-000000000007', 'supervisor-b@demo.chilearning.cl', 'tenant');

-- ---------- Superadmin de plataforma (NO es una membership — D-006) ----------
insert into public.platform_admins (user_id) values
  ('00000000-0000-4000-8000-00000000000a');

-- ---------- Curso demo con candado SENCE (Hito 0) — tenant Seminarea ----------
-- Datos ficticios. El token del OTEC NO va aquí (se cifra y se configura por UI/
-- servidor con la clave AES): token_encrypted queda NULL en el seed.
insert into public.sence_otec_config (tenant_id, rut_otec, default_environment) values
  ('11111111-1111-4111-8111-111111111111', '76111111-6', 'rcetest');

insert into public.courses (id, tenant_id, name, sence, cod_sence) values
  ('c0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'Curso demo: Prevención de riesgos e-learning', true, '1234567890');

insert into public.actions (id, tenant_id, course_id, codigo_accion, training_line, environment, attendance_lock, starts_on, ends_on, status) values
  ('ac000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-000000000001', 'ACC-DEMO-0001', 3, 'rcetest', true,
   '2026-07-01', '2026-12-31', 'active');

-- ---------- Empresas cliente demo (task 5.2, HU-8.1) — 100% FICTICIAS ----------
-- Dos empresas en el MISMO tenant: es lo que hace verificable la CA "jamás ve
-- alumnos de otras empresas". `empresa@seminarea.test` pertenece SOLO a Los Aromos;
-- Vulcano existe para que el cruce dentro del tenant sea posible de intentar.
insert into public.companies (id, tenant_id, rut, razon_social) values
  ('c1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   '77123456-9', 'Constructora Los Aromos Ltda'),
  ('c1000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   '78654321-5', 'Servicios Industriales Vulcano SpA');

-- El usuario `company` semilla queda vinculado a UNA empresa (Los Aromos). Sin esta
-- fila vería 0 inscripciones: tras la migración 20260717030000 el rol `company`
-- entra CERRADO y solo abre por vinculación explícita.
insert into public.company_members (tenant_id, company_id, user_id, email) values
  ('11111111-1111-4111-8111-111111111111', 'c1000000-0000-4000-8000-000000000001',
   'aaaaaaaa-0000-4000-8000-000000000006', 'empresa@seminarea.test');

-- Inscribe al alumno demo (alumno@seminarea.test) con un RUN ficticio válido.
-- Es TRABAJADORA de Los Aromos: la única fila que la empresa demo debe ver.
insert into public.enrollments (id, tenant_id, action_id, user_id, run, exento, first_names, last_names, company_id) values
  ('e0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'ac000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000005',
   '5126663-3', false, 'María José', 'Pérez Soto', 'c1000000-0000-4000-8000-000000000001');

-- Los otros dos inscritos de la MISMA acción, que la empresa demo NO debe ver:
--   · Rodrigo  → PARTICULAR (company_id NULL): no lo manda ninguna empresa.
--   · Carolina → trabajadora de VULCANO (la otra empresa del mismo tenant).
-- RUNs ficticios elegidos fuera de los que usan las suites (no colisionan con los
-- filtros por RUN de enrollment-service).
insert into public.enrollments (id, tenant_id, action_id, user_id, run, exento, first_names, last_names, company_id) values
  ('e0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'ac000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000008',
   '11222333-9', false, 'Rodrigo', 'Fuentes Lagos', null),
  ('e0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
   'ac000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000009',
   '18456321-5', false, 'Carolina', 'Márquez Tapia', 'c1000000-0000-4000-8000-000000000002');

-- Dos lecciones del curso demo (texto + video embed).
insert into public.lessons (tenant_id, course_id, title, kind, content, position, status) values
  ('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'Introducción a la prevención de riesgos', 'text',
   'La prevención de riesgos laborales es el conjunto de actividades orientadas a proteger la salud de las personas trabajadoras. En esta lección revisaremos los conceptos básicos: peligro, riesgo, y las medidas de control. Registrar tu asistencia SENCE es obligatorio para validar tu participación.',
   1, 'published'),
  ('11111111-1111-4111-8111-111111111111', 'c0000000-0000-4000-8000-000000000001',
   'Elementos de protección personal (EPP)', 'video', 'dQw4w9WgXcQ', 2, 'published');

-- ---------- Auditoría semilla (una por tenant, para probar lectura) ----------
insert into public.audit_log (tenant_id, actor_user_id, action, entity, details) values
  ('11111111-1111-4111-8111-111111111111', 'aaaaaaaa-0000-4000-8000-000000000001', 'seed.created', 'tenant', '{"seed":true}'),
  ('22222222-2222-4222-8222-222222222222', 'bbbbbbbb-0000-4000-8000-000000000001', 'seed.created', 'tenant', '{"seed":true}');

-- ---------- Datos demo SENCE/progreso/alertas (task 2.5: matriz RLS + panel) ----------
-- Sesión SENCE CERRADA del alumno demo: alimenta el panel de cumplimiento en
-- dev y las expectativas de lectura por rol (sence_sessions en la matriz).
insert into public.sence_sessions (id, tenant_id, enrollment_id, sence_course_code, action_code,
  training_line, run_alumno, id_sesion_alumno, id_sesion_sence, status, environment, opened_at, closed_at) values
  ('50000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'e0000000-0000-4000-8000-000000000001', '1234567890', 'ACC-DEMO-0001', 3,
   '5126663-3', 'seed-session-0001', '424242', 'cerrada', 'rcetest',
   now() - interval '2 hours', now() - interval '1 hour'),
  -- Sesión de la trabajadora de la OTRA empresa (Vulcano). Existe para que el
  -- escopado de `sence_sessions_select_staff` (task 5.2) sea VERIFICABLE: la
  -- asistencia SENCE de Carolina es dato de Vulcano, y Los Aromos jamás la ve.
  ('50000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'e0000000-0000-4000-8000-000000000003', '1234567890', 'ACC-DEMO-0001', 3,
   '18456321-5', 'seed-session-0002', '424243', 'cerrada', 'rcetest',
   now() - interval '3 hours', now() - interval '2 hours');

insert into public.sence_events (tenant_id, session_id, kind, payload, error_codes, dedupe_hash) values
  ('11111111-1111-4111-8111-111111111111', '50000000-0000-4000-8000-000000000001',
   'start_ok', '{}', '{}', 'seed-event-0001');

-- Progreso demo: la primera lección del curso, sin completar (estado neutro).
insert into public.lesson_progress (tenant_id, enrollment_id, lesson_id, completed)
select '11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-000000000001', l.id, false
from public.lessons l
where l.course_id = 'c0000000-0000-4000-8000-000000000001' and l.position = 1;

-- Alerta demo (informativa): prueba la lectura por rol de `alerts`.
insert into public.alerts (tenant_id, kind, severity, message, details) values
  ('11111111-1111-4111-8111-111111111111', 'sence_error_rate', 'info',
   'Alerta demo del seed (sin efecto operativo).', '{"seed": true}');

-- ---------- Evaluación demo (task 2.1: matriz RLS + UI en dev) ----------
-- Quiz publicado con una pregunta de cada tipo, un intento ENVIADO del alumno
-- demo y su nota oficial publicada.
insert into public.quizzes (id, tenant_id, course_id, title, description, status, passing_pct) values
  ('a0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-000000000001', 'Quiz demo: conceptos de prevención',
   'Evalúa los conceptos de la lección 1.', 'published', 60);

insert into public.questions (id, tenant_id, quiz_id, kind, prompt, body, points, position) values
  ('b0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-000000000001', 'multiple_choice',
   '¿Qué es un peligro?',
   '{"choices":[{"id":"a","text":"Una fuente con potencial de daño","correct":true},{"id":"b","text":"Un accidente ya ocurrido","correct":false},{"id":"c","text":"Una sanción de la inspección","correct":false}]}',
   2, 1),
  ('b0000000-0000-4000-8000-000000000002', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-000000000001', 'true_false',
   'El uso de EPP elimina el riesgo por completo.',
   '{"correct": false}', 1, 2),
  ('b0000000-0000-4000-8000-000000000003', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-000000000001', 'matching',
   'Une cada concepto con su definición.',
   '{"pairs":[{"id":"p1","left":"Peligro","right":"Fuente potencial de daño"},{"id":"p2","left":"Riesgo","right":"Probabilidad por consecuencia"}]}',
   3, 3);

insert into public.quiz_attempts (id, tenant_id, quiz_id, enrollment_id, attempt_number, status,
  questions_snapshot, answer_key, answers, score, max_score, grade, submitted_at) values
  ('d0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'a0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 1, 'submitted',
   '[{"id":"b0000000-0000-4000-8000-000000000002","kind":"true_false","prompt":"El uso de EPP elimina el riesgo por completo.","points":1}]',
   '{"b0000000-0000-4000-8000-000000000002":{"kind":"true_false","correct":false}}',
   '{"b0000000-0000-4000-8000-000000000002":false}', 1, 1, 7.0, now());

insert into public.grades (tenant_id, enrollment_id, source_kind, quiz_id, grade, status, published_at) values
  ('11111111-1111-4111-8111-111111111111', 'e0000000-0000-4000-8000-000000000001', 'quiz',
   'a0000000-0000-4000-8000-000000000001', 7.0, 'published', now());

-- Tarea demo con nota directa (task 2.2) + entrega del alumno.
insert into public.assignments (id, tenant_id, course_id, title, instructions, status, passing_pct) values
  ('f0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-000000000001', 'Informe: identificación de riesgos',
   'Sube un informe (PDF) identificando 3 riesgos de tu lugar de trabajo.', 'published', 60);

insert into public.submissions (id, tenant_id, assignment_id, enrollment_id, version, comment,
  file_path, file_name, file_size, mime_type, late) values
  ('e1000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'f0000000-0000-4000-8000-000000000001', 'e0000000-0000-4000-8000-000000000001', 1,
   'Adjunto mi informe.', '11111111-1111-4111-8111-111111111111/demo/entrega.pdf',
   'informe-demo.pdf', 12345, 'application/pdf', false);

-- =============================================================================
-- Tenant demo de VENTA (task 5.7, HU documentación de venta): un TERCER tenant
-- 100% FICTICIO, aditivo a los dos de arriba, con datos "ricos" (curso, SENCE,
-- evaluaciones, encuesta, certificado, foro, empresa) para el guion de demo y
-- el one-pager (docs/venta/). No toca ni depende de los tenants A/B: es
-- exclusivamente ADITIVO, así que las suites que iteran "todos los tenants"
-- (ej. superadmin) deben incluirlo en sus expectativas (ya actualizadas).
-- RUNs/RUT calculados con el mismo módulo 11 de src/modules/sence/domain/run.ts
-- (computeDv), fuera del rango que usan los filtros de las demás suites.
-- =============================================================================

insert into public.tenants (id, slug, name, rut, plan, status) values
  ('33333333-3333-4333-8333-333333333333', 'demo', 'OTEC Demo Chilearning', '76333333-7', 'standard', 'active');

-- ---------- Usuarios ficticios del tenant demo (7 roles + 4 alumnos extra) ----------
-- Los 4 extra (0008-0011) dan sustancia a las "4-5 inscripciones" pedidas: un
-- segundo trabajador de la empresa demo y tres alumnos particulares. Mismo
-- patrón que "alumno-particular"/"alumno-vulcano" del tenant Seminarea.
insert into auth.users (
  instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
  raw_app_meta_data, raw_user_meta_data, created_at, updated_at,
  confirmation_token, recovery_token, email_change_token_new, email_change
)
select
  '00000000-0000-0000-0000-000000000000'::uuid,
  u.id::uuid,
  'authenticated',
  'authenticated',
  u.email,
  extensions.crypt('Password123!', extensions.gen_salt('bf')),
  now(), '{"provider":"email","providers":["email"]}'::jsonb, '{}'::jsonb,
  now(), now(), '', '', '', ''
from (values
  ('cccccccc-0000-4000-8000-000000000001', 'admin@demo.test'),
  ('cccccccc-0000-4000-8000-000000000002', 'coordinacion@demo.test'),
  ('cccccccc-0000-4000-8000-000000000003', 'relator@demo.test'),
  ('cccccccc-0000-4000-8000-000000000004', 'tutor@demo.test'),
  ('cccccccc-0000-4000-8000-000000000005', 'alumno@demo.test'),
  ('cccccccc-0000-4000-8000-000000000006', 'empresa@demo.test'),
  ('cccccccc-0000-4000-8000-000000000007', 'supervision@demo.test'),
  ('cccccccc-0000-4000-8000-000000000008', 'alumno-extra1@demo.test'),
  ('cccccccc-0000-4000-8000-000000000009', 'alumno-extra2@demo.test'),
  ('cccccccc-0000-4000-8000-000000000010', 'alumno-extra3@demo.test'),
  ('cccccccc-0000-4000-8000-000000000011', 'alumno-extra4@demo.test')
) as u(id, email);

insert into public.memberships (tenant_id, user_id, roles, status)
select t.id::uuid, m.user_id::uuid, m.roles::public.role_key[], 'active'
from (values
  ('33333333-3333-4333-8333-333333333333', 'cccccccc-0000-4000-8000-000000000001', '{otec_admin}'),
  ('33333333-3333-4333-8333-333333333333', 'cccccccc-0000-4000-8000-000000000002', '{coordinator}'),
  ('33333333-3333-4333-8333-333333333333', 'cccccccc-0000-4000-8000-000000000003', '{instructor}'),
  ('33333333-3333-4333-8333-333333333333', 'cccccccc-0000-4000-8000-000000000004', '{tutor}'),
  ('33333333-3333-4333-8333-333333333333', 'cccccccc-0000-4000-8000-000000000005', '{student}'),
  ('33333333-3333-4333-8333-333333333333', 'cccccccc-0000-4000-8000-000000000006', '{company}'),
  ('33333333-3333-4333-8333-333333333333', 'cccccccc-0000-4000-8000-000000000007', '{supervisor}'),
  ('33333333-3333-4333-8333-333333333333', 'cccccccc-0000-4000-8000-000000000008', '{student}'),
  ('33333333-3333-4333-8333-333333333333', 'cccccccc-0000-4000-8000-000000000009', '{student}'),
  ('33333333-3333-4333-8333-333333333333', 'cccccccc-0000-4000-8000-000000000010', '{student}'),
  ('33333333-3333-4333-8333-333333333333', 'cccccccc-0000-4000-8000-000000000011', '{student}')
) as m(tenant_id, user_id, roles)
join public.tenants t on t.id = m.tenant_id::uuid;

-- Grant tenant-wide sin expiración para el supervisor semilla (mismo patrón
-- que los tenants Seminarea/Pacífico en 20260716110000): sin esta fila, el
-- portal del fiscalizador (`/supervisor`) le mostraría 0 filas a
-- supervision@demo.test — entra CERRADO por diseño (D-006/task 3.11).
insert into public.supervisor_grants (tenant_id, user_id, email, scope) values
  ('33333333-3333-4333-8333-333333333333', 'cccccccc-0000-4000-8000-000000000007',
   'supervisor-demo@demo.chilearning.cl', 'tenant');

-- ---------- Config SENCE + curso e-learning publicado (línea 3, rcetest) ----------
insert into public.sence_otec_config (tenant_id, rut_otec, default_environment) values
  ('33333333-3333-4333-8333-333333333333', '76333333-7', 'rcetest');

insert into public.courses (id, tenant_id, name, sence, cod_sence, modality, hours, completion_rules, status) values
  ('c0000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333',
   'Curso demo: Comunicación efectiva en equipos de trabajo', true, '9876543210',
   'elearning', 16,
   '{"requireAllLessons": true, "requireSurvey": true, "minAttendancePct": 75}'::jsonb,
   'published');

insert into public.actions (id, tenant_id, course_id, codigo_accion, training_line, environment, attendance_lock, starts_on, ends_on, status) values
  ('ac000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333',
   'c0000000-0000-4000-8000-000000000002', 'ACC-DEMO-9001', 3, 'rcetest', true,
   '2026-06-01', '2026-12-15', 'active');

-- ---------- Empresa cliente demo (1 empresa, 2 trabajadoras vinculadas) ----------
insert into public.companies (id, tenant_id, rut, razon_social) values
  ('c1000000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333',
   '77345678-k', 'Comercial Andina SpA');

-- El usuario `company` semilla queda vinculado a la empresa (mismo patrón que
-- el tenant Seminarea): sin esta fila el portal empresa mostraría 0 filas.
insert into public.company_members (tenant_id, company_id, user_id, email) values
  ('33333333-3333-4333-8333-333333333333', 'c1000000-0000-4000-8000-000000000003',
   'cccccccc-0000-4000-8000-000000000006', 'empresa@demo.test');

-- 5 inscripciones con RUNs ficticios (DV real, módulo 11): Camila es la alumna
-- FEATURED del guion de demo (recorrido completo); Matías es la segunda
-- trabajadora vinculada a Comercial Andina; el resto son particulares.
insert into public.enrollments (id, tenant_id, action_id, user_id, run, exento, first_names, last_names, company_id) values
  ('e0000000-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333',
   'ac000000-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000005',
   '9123456-4', false, 'Camila', 'Espinoza Leiva', 'c1000000-0000-4000-8000-000000000003'),
  ('e0000000-0000-4000-8000-000000000005', '33333333-3333-4333-8333-333333333333',
   'ac000000-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000008',
   '9234567-k', false, 'Matías', 'Silva Bravo', 'c1000000-0000-4000-8000-000000000003'),
  ('e0000000-0000-4000-8000-000000000006', '33333333-3333-4333-8333-333333333333',
   'ac000000-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000009',
   '9345678-5', false, 'Antonia', 'Reyes Muñoz', null),
  ('e0000000-0000-4000-8000-000000000007', '33333333-3333-4333-8333-333333333333',
   'ac000000-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000010',
   '9456789-0', false, 'Francisco', 'Torres Vidal', null),
  ('e0000000-0000-4000-8000-000000000008', '33333333-3333-4333-8333-333333333333',
   'ac000000-0000-4000-8000-000000000002', 'cccccccc-0000-4000-8000-000000000011',
   '9567890-4', false, 'Bárbara', 'Núñez Soto', null);

-- 5 lecciones de texto, contenido nuevo (ni copiado del curso de Seminarea).
insert into public.lessons (tenant_id, course_id, title, kind, content, position, status) values
  ('33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000002',
   'Introducción a la comunicación efectiva', 'text',
   'La comunicación efectiva es la capacidad de transmitir un mensaje de forma clara, oportuna y comprensible para quien lo recibe. En un equipo de trabajo, una buena comunicación reduce errores, mejora el clima laboral y acelera la toma de decisiones. En esta lección revisaremos los elementos básicos del proceso comunicativo: emisor, mensaje, canal, receptor y retroalimentación.',
   1, 'published'),
  ('33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000002',
   'Barreras comunes en la comunicación', 'text',
   'No toda comunicación llega como se espera. Existen barreras físicas (ruido, distancia), semánticas (uso de tecnicismos o lenguaje ambiguo) y psicológicas (prejuicios, falta de atención) que distorsionan el mensaje. Identificar estas barreras es el primer paso para superarlas y asegurar que el mensaje se entienda tal como fue pensado.',
   2, 'published'),
  ('33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000002',
   'Escucha activa y retroalimentación', 'text',
   'Escuchar activamente significa prestar atención completa a la otra persona, sin interrumpir y confirmando que se comprendió el mensaje. La retroalimentación, por su parte, debe ser oportuna, específica y orientada a mejorar, nunca a descalificar. Practicar ambas habilidades fortalece la confianza dentro del equipo.',
   3, 'published'),
  ('33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000002',
   'Comunicación asertiva y manejo de conflictos', 'text',
   'La comunicación asertiva permite expresar ideas y opiniones con claridad, respetando tanto los propios derechos como los de la otra persona, a diferencia de los estilos pasivo y agresivo. Frente a un conflicto, ser asertivo ayuda a exponer el problema sin atacar, buscar acuerdos y proponer soluciones concretas.',
   4, 'published'),
  ('33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000002',
   'Comunicación en equipos remotos e híbridos', 'text',
   'El trabajo remoto e híbrido exige adaptar la comunicación: preferir la videollamada para temas sensibles, ser explícito en los canales asincrónicos (correo, chat) y acordar tiempos de respuesta razonables. Establecer normas claras de comunicación evita malentendidos y mantiene alineado al equipo aunque no comparta un mismo espacio físico.',
   5, 'published');

insert into public.audit_log (tenant_id, actor_user_id, action, entity, details) values
  ('33333333-3333-4333-8333-333333333333', 'cccccccc-0000-4000-8000-000000000001', 'seed.created', 'tenant', '{"seed":true}');

-- ---------- Sesión SENCE cerrada de Camila (alumna featured del guion) ----------
insert into public.sence_sessions (id, tenant_id, enrollment_id, sence_course_code, action_code,
  training_line, run_alumno, id_sesion_alumno, id_sesion_sence, status, environment, opened_at, closed_at) values
  ('50000000-0000-4000-8000-000000000003', '33333333-3333-4333-8333-333333333333',
   'e0000000-0000-4000-8000-000000000004', '9876543210', 'ACC-DEMO-9001', 3,
   '9123456-4', 'seed-session-demo-0001', '525252', 'cerrada', 'rcetest',
   now() - interval '3 hours', now() - interval '2 hours');

insert into public.sence_events (tenant_id, session_id, kind, payload, error_codes, dedupe_hash) values
  ('33333333-3333-4333-8333-333333333333', '50000000-0000-4000-8000-000000000003',
   'start_ok', '{}', '{}', 'seed-event-demo-0001');

-- Progreso: Camila completó las 3 primeras lecciones (recorrido a medio camino).
insert into public.lesson_progress (tenant_id, enrollment_id, lesson_id, completed)
select '33333333-3333-4333-8333-333333333333', 'e0000000-0000-4000-8000-000000000004', l.id, true
from public.lessons l
where l.course_id = 'c0000000-0000-4000-8000-000000000002' and l.position in (1, 2, 3);

-- ---------- Evaluación demo: quiz publicado + intento enviado + nota ----------
insert into public.quizzes (id, tenant_id, course_id, title, description, status, passing_pct) values
  ('a0000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333',
   'c0000000-0000-4000-8000-000000000002', 'Quiz demo: fundamentos de comunicación efectiva',
   'Evalúa los conceptos de las lecciones 1 a 3.', 'published', 60);

insert into public.questions (id, tenant_id, quiz_id, kind, prompt, body, points, position) values
  ('b0000000-0000-4000-8000-000000000004', '33333333-3333-4333-8333-333333333333',
   'a0000000-0000-4000-8000-000000000002', 'multiple_choice',
   '¿Cuál de las siguientes es una barrera semántica de la comunicación?',
   '{"choices":[{"id":"a","text":"El uso de tecnicismos que el receptor no conoce","correct":true},{"id":"b","text":"El volumen de la voz","correct":false},{"id":"c","text":"La distancia física entre emisor y receptor","correct":false}]}',
   2, 1),
  ('b0000000-0000-4000-8000-000000000005', '33333333-3333-4333-8333-333333333333',
   'a0000000-0000-4000-8000-000000000002', 'true_false',
   'La escucha activa consiste solo en guardar silencio mientras la otra persona habla.',
   '{"correct": false}', 1, 2),
  ('b0000000-0000-4000-8000-000000000006', '33333333-3333-4333-8333-333333333333',
   'a0000000-0000-4000-8000-000000000002', 'matching',
   'Une cada estilo de comunicación con su descripción.',
   '{"pairs":[{"id":"p1","left":"Asertivo","right":"Expresa su punto de vista respetando al otro"},{"id":"p2","left":"Pasivo","right":"Evita expresar su opinión por temor al conflicto"}]}',
   3, 3);

insert into public.quiz_attempts (id, tenant_id, quiz_id, enrollment_id, attempt_number, status,
  questions_snapshot, answer_key, answers, score, max_score, grade, submitted_at) values
  ('d0000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333',
   'a0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000004', 1, 'submitted',
   '[{"id":"b0000000-0000-4000-8000-000000000005","kind":"true_false","prompt":"La escucha activa consiste solo en guardar silencio mientras la otra persona habla.","points":1}]',
   '{"b0000000-0000-4000-8000-000000000005":{"kind":"true_false","correct":false}}',
   '{"b0000000-0000-4000-8000-000000000005":false}', 1, 1, 6.8, now());

insert into public.grades (tenant_id, enrollment_id, source_kind, quiz_id, grade, status, published_at) values
  ('33333333-3333-4333-8333-333333333333', 'e0000000-0000-4000-8000-000000000004', 'quiz',
   'a0000000-0000-4000-8000-000000000002', 6.8, 'published', now());

-- Tarea demo con nota directa + entrega de Camila.
insert into public.assignments (id, tenant_id, course_id, title, instructions, status, passing_pct) values
  ('f0000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333',
   'c0000000-0000-4000-8000-000000000002', 'Informe: plan de comunicación de mi equipo',
   'Redacta un breve informe (máx. 1 página) describiendo tres acciones concretas para mejorar la comunicación de tu equipo de trabajo.', 'published', 60);

insert into public.submissions (id, tenant_id, assignment_id, enrollment_id, version, comment,
  file_path, file_name, file_size, mime_type, late) values
  ('e1000000-0000-4000-8000-000000000002', '33333333-3333-4333-8333-333333333333',
   'f0000000-0000-4000-8000-000000000002', 'e0000000-0000-4000-8000-000000000004', 1,
   'Adjunto mi propuesta de plan de comunicación.', '33333333-3333-4333-8333-333333333333/demo/entrega.pdf',
   'informe-demo.pdf', 15234, 'application/pdf', false);

-- ---------- Encuesta publicada + 1 respuesta anónima vía RPC submit_survey ----------
insert into public.surveys (id, tenant_id, course_id, title, intro, anonymous, status, questions) values
  ('70000000-0000-4000-8000-000000000001', '33333333-3333-4333-8333-333333333333',
   'c0000000-0000-4000-8000-000000000002', 'Encuesta de satisfacción: comunicación efectiva',
   'Tu opinión nos ayuda a mejorar el curso.', true, 'published',
   '{"questions":[{"id":"q1","type":"scale","label":"¿Qué tan útil te pareció el curso?","required":true,"scaleMax":5},{"id":"q2","type":"text","label":"Comentarios adicionales","required":false}]}'::jsonb);

-- El ledger (survey_submissions) + la respuesta (survey_responses, anónima →
-- sin enrollment_id) se insertan atómicamente por el RPC real (mismo camino
-- que usa la app; nunca un INSERT directo a survey_responses).
select public.submit_survey(
  '33333333-3333-4333-8333-333333333333'::uuid,
  '70000000-0000-4000-8000-000000000001'::uuid,
  'ac000000-0000-4000-8000-000000000002'::uuid,
  'e0000000-0000-4000-8000-000000000004'::uuid,
  true,
  '{"q1":5,"q2":"Muy claro y aplicable a mi pega diaria."}'::jsonb
);

-- ---------- Certificado EMITIDO vía RPC issue_certificate (folio + audit) ----------
-- Snapshot §7-R7 con las mismas claves que src/modules/certificados/domain/
-- snapshot.ts (CertificateSnapshot). p_pdf_path va NULL: el render del PDF es
-- best-effort en el flujo real (certificates-service.ts) y este seed no sube
-- el binario — el folio/token/snapshot ya alcanzan para narrar y verificar.
select public.issue_certificate(
  '60000000-0000-4000-8000-000000000001'::uuid,
  '33333333-3333-4333-8333-333333333333'::uuid,
  'e0000000-0000-4000-8000-000000000004'::uuid,
  'ac000000-0000-4000-8000-000000000002'::uuid,
  'c0000000-0000-4000-8000-000000000002'::uuid,
  true,
  '16df37c4679f6ced9a774b068d82d2b8',
  jsonb_build_object(
    'studentName', 'Camila Espinoza Leiva',
    'run', '9123456-4',
    'runMasked', '91.XXX.XXX-X',
    'courseName', 'Curso demo: Comunicación efectiva en equipos de trabajo',
    'hours', 16,
    'startsOn', '2026-06-01',
    'endsOn', '2026-12-15',
    'finalGrade', 6.5,
    'codSence', '9876543210',
    'actionCode', 'ACC-DEMO-9001',
    'attendancePct', 100,
    'otecName', 'OTEC Demo Chilearning',
    'otecRut', '76333333-7',
    'brandPrimary', '#1e3a8a',
    'brandAccent', '#0ea5e9',
    'logoUrl', null,
    'isSence', true,
    'issuedAtISO', to_char(now() at time zone 'utc', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
  ),
  null,
  'cccccccc-0000-4000-8000-000000000001'::uuid
);

-- ---------- Anuncio publicado + hilo de foro con respuesta del relator ----------
insert into public.announcements (tenant_id, course_id, author_user_id, title, body, status, published_at) values
  ('33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000002',
   'cccccccc-0000-4000-8000-000000000001', 'Bienvenida al curso demo',
   'Bienvenida a todas y todos al curso demo de Chilearning. Revisen las lecciones en orden y no olviden registrar su asistencia SENCE antes de avanzar.',
   'published', now());

with new_thread as (
  insert into public.forum_threads (tenant_id, course_id, author_user_id, title, resolved, resolved_by, resolved_at)
  values (
    '33333333-3333-4333-8333-333333333333', 'c0000000-0000-4000-8000-000000000002',
    'cccccccc-0000-4000-8000-000000000005', 'Duda sobre feedback en equipos remotos',
    true, 'cccccccc-0000-4000-8000-000000000003', now()
  )
  returning id, tenant_id
)
-- Los literales uuid van con `::uuid` EXPLÍCITO: en un UNION ALL, Postgres
-- resuelve el tipo de columna entre ambas ramas ANTES de mirar el INSERT
-- destino, y dos literales "unknown" se resuelven a `text` (no a `uuid`) — sin
-- el cast, el INSERT final falla con "is of type uuid but expression is of
-- type text" (verificado con `supabase db reset` real).
insert into public.forum_posts (tenant_id, thread_id, author_user_id, from_staff, body)
select tenant_id, id, 'cccccccc-0000-4000-8000-000000000005'::uuid, false,
  '¿Cómo doy retroalimentación constructiva cuando el equipo trabaja 100% remoto y casi no hay instancias cara a cara?'
from new_thread
union all
select tenant_id, id, 'cccccccc-0000-4000-8000-000000000003'::uuid, true,
  'Buena pregunta: para temas sensibles prioriza una videollamada, sé específico con ejemplos concretos y agenda un espacio 1:1 semanal con cada persona del equipo.'
from new_thread;
