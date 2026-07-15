-- =============================================================================
-- Seeds de desarrollo (task 0.2): 2 tenants × 8 roles, datos 100% FICTICIOS.
-- Regla dura: JAMÁS datos reales de personas en seeds/fixtures.
-- UUIDs deterministas para que la suite RLS los referencie.
-- Password local de todos los usuarios: 'Password123!' (solo dev).
-- =============================================================================

insert into public.tenants (id, slug, name, rut, plan, status) values
  ('11111111-1111-4111-8111-111111111111', 'otec-andes',    'OTEC Demo Andes SpA',     '76111111-6', 'standard', 'active'),
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
  -- Tenant A: OTEC Demo Andes
  ('aaaaaaaa-0000-4000-8000-000000000001', 'admin@otec-andes.test'),
  ('aaaaaaaa-0000-4000-8000-000000000002', 'coordinacion@otec-andes.test'),
  ('aaaaaaaa-0000-4000-8000-000000000003', 'relator@otec-andes.test'),
  ('aaaaaaaa-0000-4000-8000-000000000004', 'tutor@otec-andes.test'),
  ('aaaaaaaa-0000-4000-8000-000000000005', 'alumno@otec-andes.test'),
  ('aaaaaaaa-0000-4000-8000-000000000006', 'empresa@otec-andes.test'),
  ('aaaaaaaa-0000-4000-8000-000000000007', 'supervision@otec-andes.test'),
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

insert into public.actions (id, tenant_id, course_id, codigo_accion, training_line, environment, attendance_lock, starts_on, ends_on) values
  ('ac000000-0000-4000-8000-000000000001', '11111111-1111-4111-8111-111111111111',
   'c0000000-0000-4000-8000-000000000001', 'ACC-DEMO-0001', 3, 'rcetest', true,
   '2026-07-01', '2026-12-31');

-- Inscribe al alumno demo (alumno@otec-andes.test) con un RUN ficticio válido.
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
