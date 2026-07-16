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

-- ---------- Curso demo con candado SENCE (Hito 0) — tenant Andes ----------
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

-- Inscribe al alumno demo (alumno@seminarea.test) con un RUN ficticio válido.
insert into public.enrollments (id, tenant_id, action_id, user_id, run, exento, first_names, last_names) values
  ('e0000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'ac000000-0000-4000-8000-000000000001', 'aaaaaaaa-0000-4000-8000-000000000005',
   '5126663-3', false, 'María José', 'Pérez Soto');

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
   now() - interval '2 hours', now() - interval '1 hour');

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
