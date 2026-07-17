-- =============================================================================
-- Task 5.12 (Hito 5, HU-7.3): vigencia y recertificación de certificados.
--
-- CA de la HU: el coordinador configura VIGENCIA en cursos normativos; el
-- certificado lleva fecha de vencimiento; el sistema alerta (90/60/30 días,
-- configurable, vía n8n) a la OTEC y a la empresa; listado de vencimientos por
-- empresa exportable; enlace directo a re-inscripción en una acción nueva.
--
-- DECISIONES DE ESTA MIGRACIÓN
-- ----------------------------
--  - `courses.validity_months` NULL = el certificado NO vence (default). La
--    vigencia es propia del CURSO (una norma dura 12/24 meses), no de la acción.
--  - `certificates.expires_at` va como COLUMNA, deliberadamente FUERA del
--    `snapshot`. El snapshot es el documento legal CONGELADO e INMUTABLE (D-112,
--    trigger `certificates_status_guard`): meter ahí la vigencia obligaría a
--    reescribirlo para corregir un dato OPERATIVO (recordatorios), y el trigger
--    lo impide. Además el PDF es función determinista del snapshot: si la
--    vigencia entrara al snapshot, cambiarla cambiaría el PDF ya emitido.
--    `expires_at` es metadato de operación: cuándo avisar que toca recertificar.
--  - El ledger de alertas es INSERT-only y `unique (certificate_id, offset_days)`:
--    ESA es la idempotencia del job. El worker inserta ANTES de notificar
--    (ledger-first): si el correo falla, no se reintenta a costa de spamear; si
--    el proceso muere entre insert y correo, se pierde UN aviso, nunca se duplica.
-- =============================================================================

-- ---------- courses.validity_months (NULL = no vence) ----------
alter table public.courses
  add column validity_months smallint
    check (validity_months is null or validity_months between 1 and 120);

comment on column public.courses.validity_months is
  'Vigencia del certificado en meses (HU-7.3). NULL = no vence. Tope 120 (10 años).';

-- ---------- certificates.expires_at (metadato operativo, NO va al snapshot) ----------
alter table public.certificates
  add column expires_at timestamptz;

comment on column public.certificates.expires_at is
  'Vencimiento del certificado (HU-7.3). NULL = no vence. FUERA del snapshot a '
  'propósito: el snapshot es el documento legal inmutable (D-112) y esto es dato '
  'operativo para las alertas de recertificacion.';

-- Índice PARCIAL: el job barre exactamente esto (vigentes con vencimiento) y es
-- una fracción mínima de la tabla — el resto (revocados, sin vigencia) no entra
-- ni al índice.
create index certificates_expiry_idx
  on public.certificates (tenant_id, expires_at)
  where status = 'issued' and expires_at is not null;

-- ---------- certificate_expiry_config (offsets por tenant) ----------
create table public.certificate_expiry_config (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  -- Días de anticipación. Default = los 90/60/30 de la CA.
  offsets_days int[] not null default '{90,60,30}',
  enabled boolean not null default true,
  updated_by uuid,
  updated_at timestamptz not null default now(),
  -- Sin fila = defaults (el job trata "sin config" como habilitado con 90/60/30),
  -- así que estos checks solo acotan lo que un tenant configura EXPLÍCITAMENTE.
  -- ⚠ `coalesce(…, 0)`: `array_length('{}', 1)` es NULL, y `NULL between 1 and 10`
  -- es NULL — que un CHECK da por VÁLIDO. Sin el coalesce, un array VACÍO pasaba
  -- (verificado), y "sin offsets" es justo la config que apagaría los avisos por
  -- la puerta de atrás en vez de con `enabled = false`.
  constraint certificate_expiry_config_offsets_len
    check (coalesce(array_length(offsets_days, 1), 0) between 1 and 10),
  -- Cada offset en 1..365. Se cuantifica con `<= all(array)` (un CHECK no admite
  -- subconsultas, así que `not exists (select … from unnest(…))` no es opción).
  -- El `array_position(…, null)` es necesario: con un NULL dentro del array los
  -- `all()` devuelven NULL y el CHECK pasaría (NULL no es false).
  constraint certificate_expiry_config_offsets_range
    check (
      array_position(offsets_days, null) is null
      and 1 <= all(offsets_days)
      and 365 >= all(offsets_days)
    )
);

alter table public.certificate_expiry_config enable row level security;
alter table public.certificate_expiry_config force row level security;

-- Lectura: staff que configura la vigencia (la CA da la config al coordinador).
-- Ni el alumno ni la empresa la leen: es política interna del OTEC.
create policy certificate_expiry_config_select on public.certificate_expiry_config
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (public.has_role('otec_admin') or public.has_role('coordinator'))
    )
  );
grant select on public.certificate_expiry_config to authenticated;
-- La escritura va SIEMPRE por `expiry-config-service` (authorize + audit): sin
-- grant de write a `authenticated`, el único camino es el servidor.
-- CON DELETE, a diferencia del ledger de abajo: esto es CONFIGURACIÓN, no una
-- bitácora — borrar la fila significa "volver a los defaults 90/60/30", que es
-- un estado legítimo y alcanzable. (Sin este grant el borrado falla en SILENCIO
-- por PostgREST: se descubrió porque dejaba residuo entre suites y encogía la
-- ventana del job a la config de otro test.)
grant select, insert, update, delete on public.certificate_expiry_config to service_role;

-- ---------- certificate_expiry_alerts (ledger INSERT-only: la idempotencia) ----------
create table public.certificate_expiry_alerts (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  certificate_id uuid not null references public.certificates (id) on delete restrict,
  offset_days int not null check (offset_days between 1 and 365),
  sent_at timestamptz not null default now(),
  -- El invariante que hace idempotente al job: un aviso por (certificado, offset)
  -- y punto. El worker inserta primero y tolera el 23505 — eso es "ya avisado".
  constraint certificate_expiry_alerts_uk unique (certificate_id, offset_days)
);
create index certificate_expiry_alerts_tenant_idx
  on public.certificate_expiry_alerts (tenant_id, sent_at desc);

alter table public.certificate_expiry_alerts enable row level security;
alter table public.certificate_expiry_alerts force row level security;

-- Lectura de staff (es la bitácora de "a quién ya se le avisó").
create policy certificate_expiry_alerts_select on public.certificate_expiry_alerts
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        public.has_role('otec_admin') or public.has_role('coordinator')
        or public.has_role('instructor')
      )
    )
  );
grant select on public.certificate_expiry_alerts to authenticated;
-- INSERT-only, ni para el service_role: sin UPDATE ni DELETE, "ya avisé" no se
-- reescribe (mismo criterio que `sence_events` y `audit_log`). Si se pudiera
-- borrar una fila, se podría re-spamear al alumno.
grant select, insert on public.certificate_expiry_alerts to service_role;

-- ---------- notifications.kind: + certificate.expiring ----------
-- Se recrea con la lista COMPLETA (el CHECK no es acumulable).
alter table public.notifications drop constraint notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check
  check (kind in (
    'grade.published', 'announcement.published', 'forum.reply', 'message.received',
    'reminder.no_attendance', 'reminder.inactive', 'reminder.coordinator_report',
    'certificate.expiring'
  ));

-- ---------- RPC issue_certificate: + p_expires_at ----------
-- ⚠ `create or replace` con una firma nueva NO reemplaza: crea un OVERLOAD, y
-- PostgREST resolvería la llamada de forma ambigua. Hay que DROPear la función
-- por su lista EXACTA de argumentos y recrearla. El cuerpo se copia IDÉNTICO al
-- de 20260716102000 salvo (a) el insert de `expires_at` y (b) el `detail` del
-- audit. Su único llamador (`certificates-service.ts`) se actualiza en ESTE PR.
drop function public.issue_certificate(uuid, uuid, uuid, uuid, uuid, boolean, text, jsonb, text, uuid);

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
  p_actor uuid,
  -- Default NULL = "no vence": un llamador que no sepa de vigencia sigue emitiendo.
  p_expires_at timestamptz default null
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
  -- Consistencia de tenant + que la acción sea del curso indicado (4-ojos L1).
  if not exists (
    select 1 from public.enrollments e
    join public.actions a on a.id = e.action_id
    where e.id = p_enrollment_id and e.tenant_id = p_tenant_id
      and e.action_id = p_action_id and a.course_id = p_course_id
  ) then
    raise exception 'inscripcion/accion/curso no consistente con el tenant';
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
    is_sence, snapshot, pdf_path, issued_by, expires_at
  ) values (
    p_id, p_tenant_id, p_enrollment_id, p_action_id, p_course_id, v_folio, p_token,
    coalesce(p_is_sence, false), p_snapshot, p_pdf_path, p_actor, p_expires_at
  );

  insert into public.audit_log (tenant_id, actor_user_id, action, entity, entity_id, details)
    values (p_tenant_id, p_actor, 'certificate.issued', 'certificates', p_id::text,
            jsonb_build_object('folio', v_folio, 'enrollmentId', p_enrollment_id,
                               'expiresAt', p_expires_at));

  return v_folio;
end;
$$;
revoke all on function public.issue_certificate(uuid, uuid, uuid, uuid, uuid, boolean, text, jsonb, text, uuid, timestamptz) from public;
grant execute on function public.issue_certificate(uuid, uuid, uuid, uuid, uuid, boolean, text, jsonb, text, uuid, timestamptz) to service_role;
