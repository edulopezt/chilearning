-- =============================================================================
-- Task 3.2 (Hito 3, HU-7.1/7.2, §7-R7): certificados PDF con plantilla SENCE.
--
-- Emisión individual/masiva para quienes cumplen las reglas de completitud;
-- PDF con marca del tenant, folio único y QR; verificación PÚBLICA por token
-- (datos mínimos, RUN enmascarado — P4); revocación con motivo (auditada).
--
-- Decisiones:
--  - D-112 SNAPSHOT congelado en emisión (no datos vivos): un certificado es un
--    documento legal; el PDF es función determinista del snapshot → regenerable.
--  - D-113 folio `CERT-{año}-{seq6}`, contador atómico por (tenant, año).
--  - D-114 `verification_token` opaco (anti-enumeración); el QR/verificación usan
--    el token, no el folio.
--  - D-115 verificación pública por RPC SECURITY DEFINER `verify_certificate`
--    (EXECUTE anon+authenticated), devuelve solo mínimos + RUN enmascarado.
--  - §7-R7: la lista de campos es DEFAULT del spec (flag para Edu). El PDF del LMS
--    es el certificado de la OTEC, NO la Declaración Jurada oficial de la GCA.
-- =============================================================================

create type public.certificate_status as enum ('issued', 'revoked');

-- Umbral de asistencia SENCE por acción (override del curso; NULL = usa el del curso).
alter table public.actions
  add column min_attendance_pct_override smallint
    check (min_attendance_pct_override is null or (min_attendance_pct_override between 0 and 100));

-- ---------- certificates (ledger; sin DELETE — revocar es un UPDATE) ----------
create table public.certificates (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  enrollment_id uuid not null references public.enrollments (id) on delete restrict,
  action_id uuid not null references public.actions (id) on delete restrict,
  course_id uuid not null references public.courses (id) on delete restrict,
  folio text not null,
  verification_token text not null,
  status public.certificate_status not null default 'issued',
  is_sence boolean not null default false,
  -- §7-R7 congelado (nombre, run, runMasked, curso, horas, fechas, nota, codSence,
  -- codigo de acción, %asistencia, razón social + rut OTEC, marca, isSence, emisión).
  snapshot jsonb not null,
  pdf_path text,
  issued_by uuid,
  issued_at timestamptz not null default now(),
  revoked_reason text,
  revoked_by uuid,
  revoked_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (tenant_id, folio),
  unique (verification_token),
  constraint certificates_revoked_fields
    check (status = 'issued' or (revoked_reason is not null and revoked_at is not null))
);
-- Un solo certificado VIGENTE por inscripción (revocar libera para re-emitir).
create unique index certificates_one_issued
  on public.certificates (enrollment_id) where status = 'issued';
create index certificates_tenant_idx on public.certificates (tenant_id);
create index certificates_action_idx on public.certificates (action_id);
create index certificates_enrollment_idx on public.certificates (enrollment_id);
create trigger certificates_touch before update on public.certificates
  for each row execute function public.touch_updated_at();

-- Guardia: un certificado revocado no se reactiva (patrón grades_no_unpublish).
create or replace function public.certificates_status_guard()
returns trigger
language plpgsql
as $$
begin
  if old.status = 'revoked' and new.status = 'issued' then
    raise exception 'un certificado revocado no puede reactivarse' using errcode = '42501';
  end if;
  return new;
end;
$$;
create trigger certificates_status_guard_trg
  before update on public.certificates
  for each row execute function public.certificates_status_guard();

alter table public.certificates enable row level security;
alter table public.certificates force row level security;

-- Lectura: staff del tenant (otec_admin/coordinator/instructor/supervisor) +
-- el alumno dueño. La verificación PÚBLICA no pasa por aquí (usa el RPC).
create policy certificates_select on public.certificates
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        public.has_role('otec_admin') or public.has_role('coordinator')
        or public.has_role('instructor') or public.has_role('supervisor')
        or exists (
          select 1 from public.enrollments e
          where e.id = certificates.enrollment_id and e.user_id = (select auth.uid())
        )
      )
    )
  );
grant select on public.certificates to authenticated;
-- Sin DELETE ni para service_role: los certificados no se borran (P8).
grant select, insert, update on public.certificates to service_role;

-- ---------- certificate_counters (folio atómico por tenant × año) ----------
create table public.certificate_counters (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  year int not null,
  last_seq int not null default 0,
  primary key (tenant_id, year)
);
alter table public.certificate_counters enable row level security;
alter table public.certificate_counters force row level security;
-- Solo el servidor (service_role, bypassa RLS). Sin grant a authenticated.
grant select, insert, update on public.certificate_counters to service_role;

-- ---------- RPC issue_certificate (folio atómico + audit) ----------
create or replace function public.issue_certificate(
  p_id uuid,
  p_tenant_id uuid,
  p_enrollment_id uuid,
  p_action_id uuid,
  p_course_id uuid,
  p_is_sence boolean,
  p_token text,
  p_snapshot jsonb,
  p_pdf_path text,
  p_actor uuid
)
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_year int;
  v_seq int;
  v_folio text;
begin
  if p_tenant_id is null or p_enrollment_id is null then
    raise exception 'tenant_id y enrollment_id son obligatorios';
  end if;
  -- Consistencia de tenant (defensa en profundidad).
  if not exists (
    select 1 from public.enrollments e
    where e.id = p_enrollment_id and e.tenant_id = p_tenant_id and e.action_id = p_action_id
  ) then
    raise exception 'inscripcion/accion no consistente con el tenant';
  end if;

  v_year := extract(year from (now() at time zone 'America/Santiago'))::int;

  insert into public.certificate_counters (tenant_id, year, last_seq)
    values (p_tenant_id, v_year, 1)
    on conflict (tenant_id, year)
    do update set last_seq = public.certificate_counters.last_seq + 1
    returning last_seq into v_seq;

  v_folio := 'CERT-' || v_year::text || '-' || lpad(v_seq::text, 6, '0');

  -- El unique index certificates_one_issued aborta si ya hay uno vigente.
  insert into public.certificates (
    id, tenant_id, enrollment_id, action_id, course_id, folio, verification_token,
    is_sence, snapshot, pdf_path, issued_by
  ) values (
    p_id, p_tenant_id, p_enrollment_id, p_action_id, p_course_id, v_folio, p_token,
    coalesce(p_is_sence, false), p_snapshot, p_pdf_path, p_actor
  );

  insert into public.audit_log (tenant_id, actor_user_id, action, entity, entity_id, details)
    values (p_tenant_id, p_actor, 'certificate.issued', 'certificates', p_id::text,
            jsonb_build_object('folio', v_folio, 'enrollmentId', p_enrollment_id));

  return v_folio;
end;
$$;
revoke all on function public.issue_certificate(uuid, uuid, uuid, uuid, uuid, boolean, text, jsonb, text, uuid) from public;
grant execute on function public.issue_certificate(uuid, uuid, uuid, uuid, uuid, boolean, text, jsonb, text, uuid) to service_role;

-- ---------- RPC revoke_certificate (issued → revoked + audit) ----------
create or replace function public.revoke_certificate(
  p_id uuid,
  p_tenant_id uuid,
  p_reason text,
  p_actor uuid
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_found int;
begin
  if p_reason is null or length(trim(p_reason)) = 0 then
    raise exception 'el motivo de revocacion es obligatorio';
  end if;
  update public.certificates
    set status = 'revoked', revoked_reason = p_reason, revoked_by = p_actor, revoked_at = now()
    where id = p_id and tenant_id = p_tenant_id and status = 'issued';
  get diagnostics v_found = row_count;
  if v_found = 0 then
    raise exception 'certificado no encontrado o ya revocado';
  end if;

  insert into public.audit_log (tenant_id, actor_user_id, action, entity, entity_id, details)
    values (p_tenant_id, p_actor, 'certificate.revoked', 'certificates', p_id::text,
            jsonb_build_object('reason', p_reason));
end;
$$;
revoke all on function public.revoke_certificate(uuid, uuid, text, uuid) from public;
grant execute on function public.revoke_certificate(uuid, uuid, text, uuid) to service_role;

-- ---------- RPC verify_certificate (PÚBLICO: mínimos + RUN enmascarado) ----------
-- Devuelve solo lo que la verificación pública puede mostrar (P4): nunca el RUN
-- completo ni datos comerciales. Accesible por anon (la página /verificar).
create or replace function public.verify_certificate(p_token text)
returns table (
  folio text,
  status public.certificate_status,
  revoked_reason text,
  student_name text,
  run_masked text,
  course_name text,
  hours int,
  starts_on text,
  ends_on text,
  otec_name text,
  issued_at timestamptz
)
language sql
security definer
stable
set search_path = ''
as $$
  select
    c.folio,
    c.status,
    case when c.status = 'revoked' then c.revoked_reason else null end,
    c.snapshot ->> 'studentName',
    c.snapshot ->> 'runMasked',
    c.snapshot ->> 'courseName',
    (c.snapshot ->> 'hours')::int,
    c.snapshot ->> 'startsOn',
    c.snapshot ->> 'endsOn',
    c.snapshot ->> 'otecName',
    c.issued_at
  from public.certificates c
  where c.verification_token = p_token
$$;
revoke all on function public.verify_certificate(text) from public;
grant execute on function public.verify_certificate(text) to anon, authenticated;

-- ---------- bucket privado `certificates` (PDF con RUN completo) ----------
-- Nunca servido por la ruta pública; descarga autenticada (dueño o staff) por
-- signed URL. CERO policies para authenticated (deny-by-default).
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('certificates', 'certificates', false, 10485760, array['application/pdf'])
on conflict (id) do nothing;
