-- =============================================================================
-- Task 5.8a (Hito 5, M11, ADR-007, RNF-10): Tutor IA — esquema del RAG híbrido.
--
-- Decisión de diseño (reemplaza un diseño anterior "FTS-only"): con OpenRouter
-- SÍ hay embeddings disponibles, así que el retrieval es HÍBRIDO real:
--   - FTS spanish (Postgres nativo) SIEMPRE disponible → base y fallback.
--   - Embeddings OpenRouter (pgvector, HNSW) → retrieval PRIMARIO cuando hay
--     `OPENROUTER_API_KEY` configurada, con fallback automático a FTS si no la
--     hay o si la llamada de embeddings falla (ver `src/modules/tutor-ia/retrieval.ts`).
-- Esto cumple el ADR-007 ("RAG sobre pgvector de Supabase") de verdad y sigue
-- funcionando sin ninguna key (CI/staging verdes sin `OPENROUTER_API_KEY`).
--
-- HU-11.3 (minimización estricta): `tutor_conversations`/`tutor_messages` son
-- datos DEL ALUMNO, no un registro de gestión — el staff académico (otec_admin/
-- coordinator/instructor) NO tiene rama de lectura sobre ellas (a diferencia de
-- `certificates`/`scorm_cmi`, donde sí la tiene). Solo el propio alumno dueño y
-- el superadmin (soporte de plataforma) las leen.
--
-- ⚠ `course_chunks.lesson_id` referencia `lessons` con `on delete restrict`:
-- una lección con chunks NO se puede borrar directo. `deleteLesson` (task 1.4)
-- se actualiza en este PR para soltar sus chunks primero.
-- =============================================================================

create extension if not exists vector with schema extensions;

-- ---------- course_chunks (índice de contenido del tutor IA) ----------
-- ⚠ Límite conocido de minimización: `content` es contenido curricular tal
-- cual lo redactó el relator/instructor (via `lessons.content`) — NO pasa por
-- ningún saneo de PII (a diferencia del `firstName` que sí sanea `prompt.ts`
-- antes de llegar al modelo). Si un instructor pega un RUN/correo/nombre real
-- en el material, ese texto llega íntegro al prompt del tutor. Higiene de
-- este campo = responsabilidad editorial de la OTEC, no de este esquema.
create table public.course_chunks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  course_id uuid not null references public.courses (id) on delete restrict,
  lesson_id uuid not null references public.lessons (id) on delete restrict,
  chunk_index smallint not null,
  lesson_title text not null,
  content text not null check (length(content) between 1 and 4000),
  -- FTS SIEMPRE disponible (base y fallback del retrieval híbrido).
  content_tsv tsvector generated always as (to_tsvector('spanish', content)) stored,
  -- NULL hasta que `aiClient.configured` (OpenRouter) genere el vector; el
  -- retrieval lexical sigue funcionando aunque esto quede vacío para siempre.
  embedding extensions.vector(1536),
  -- Qué modelo generó `embedding` — si el modelo default cambia en el futuro,
  -- permite distinguir vectores de generaciones distintas (no comparables).
  embedding_model text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (lesson_id, chunk_index)
);

create index course_chunks_content_tsv_idx on public.course_chunks using gin (content_tsv);
-- Parcial: solo filas CON embedding real — evita indexar (y desperdiciar
-- espacio en) los NULL de tenants/lecciones sin proveedor de IA configurado.
create index course_chunks_embedding_idx on public.course_chunks
  using hnsw (embedding extensions.vector_cosine_ops)
  where embedding is not null;

create trigger course_chunks_touch before update on public.course_chunks
  for each row execute function public.touch_updated_at();

alter table public.course_chunks enable row level security;
alter table public.course_chunks force row level security;

-- Cualquier rol del tenant lee (staff para gestión, alumno para que el
-- retrieval del tutor funcione vía el servicio) — mismo alcance que `lessons`.
create policy course_chunks_select on public.course_chunks
  for select to authenticated
  using (tenant_id = public.jwt_tenant_id() or public.is_superadmin());

grant select on public.course_chunks to authenticated;
grant select, insert, update, delete on public.course_chunks to service_role;

-- ---------- tutor_course_config (feature + límite diario, por curso) ----------
create table public.tutor_course_config (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  course_id uuid not null references public.courses (id) on delete restrict,
  enabled boolean not null default false,
  -- NULL = usa AI_MONTHLY_TOKEN_BUDGET_DEFAULT/el default de env (enforcement
  -- llega en 5.8b; aquí solo se declara el esquema del límite, CA HU-11.2).
  daily_message_limit int,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid,
  primary key (tenant_id, course_id)
);

create trigger tutor_course_config_touch before update on public.tutor_course_config
  for each row execute function public.touch_updated_at();

alter table public.tutor_course_config enable row level security;
alter table public.tutor_course_config force row level security;

-- TODO el tenant lee (el alumno necesita saber si el tutor está prendido, sin
-- exponer nada sensible); insert/update solo otec_admin/coordinator vía el
-- servicio (service_role + chequeo de rol en la capa de aplicación, mismo
-- patrón que `lesson-service.ts`).
create policy tutor_course_config_select on public.tutor_course_config
  for select to authenticated
  using (tenant_id = public.jwt_tenant_id() or public.is_superadmin());

grant select on public.tutor_course_config to authenticated;
grant select, insert, update on public.tutor_course_config to service_role;

-- ---------- tutor_conversations (HU-11.3: SOLO el propio alumno) ----------
create table public.tutor_conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  enrollment_id uuid not null references public.enrollments (id) on delete restrict,
  course_id uuid not null references public.courses (id) on delete restrict,
  -- Denormalizado del alumno: evita que la policy necesite un join a
  -- `enrollments` (más simple de razonar y más barato de evaluar por fila).
  user_id uuid not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index tutor_conversations_user_idx on public.tutor_conversations (tenant_id, user_id, course_id);

create trigger tutor_conversations_touch before update on public.tutor_conversations
  for each row execute function public.touch_updated_at();

alter table public.tutor_conversations enable row level security;
alter table public.tutor_conversations force row level security;

-- Decisión de minimización (HU-11.3): el staff académico NO tiene rama de
-- lectura aquí — a diferencia de `certificates`/`scorm_cmi`. Solo el propio
-- alumno dueño y el superadmin (soporte de plataforma).
create policy tutor_conversations_select on public.tutor_conversations
  for select to authenticated
  using (
    public.is_superadmin()
    or (tenant_id = public.jwt_tenant_id() and user_id = (select auth.uid()))
  );

grant select on public.tutor_conversations to authenticated;
-- DELETE incluido: la purga por retención propia (HU-11.3, `tutor-maintenance.ts`,
-- job `tutor-reconcile-tick`) borra conversaciones vencidas.
grant select, insert, update, delete on public.tutor_conversations to service_role;

-- ---------- tutor_messages (HU-11.3: mismo alcance que tutor_conversations) ----------
create table public.tutor_messages (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  conversation_id uuid not null references public.tutor_conversations (id) on delete restrict,
  -- Denormalizado (mismo motivo que en tutor_conversations).
  user_id uuid not null,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(content) <= 8000),
  citations jsonb not null default '[]'::jsonb,
  input_tokens int,
  output_tokens int,
  created_at timestamptz not null default now()
);

create index tutor_messages_conversation_idx on public.tutor_messages (conversation_id, created_at);

alter table public.tutor_messages enable row level security;
alter table public.tutor_messages force row level security;

create policy tutor_messages_select on public.tutor_messages
  for select to authenticated
  using (
    public.is_superadmin()
    or (tenant_id = public.jwt_tenant_id() and user_id = (select auth.uid()))
  );

grant select on public.tutor_messages to authenticated;
-- Sin UPDATE/DELETE para nadie (ni service_role): historial inmutable, mismo
-- espíritu que `audit_log`/`sence_events`. La única mutación futura es el
-- BORRADO por retención (`runTutorReconcile`, HU-11.3), que sí necesita
-- DELETE — se otorga explícitamente para eso, no para editar contenido.
grant select, insert, delete on public.tutor_messages to service_role;

-- ---------- tutor_usage_daily (contador agregado por alumno × día) ----------
create table public.tutor_usage_daily (
  tenant_id uuid not null references public.tenants (id) on delete restrict,
  user_id uuid not null,
  day date not null,
  messages int not null default 0,
  input_tokens bigint not null default 0,
  output_tokens bigint not null default 0,
  primary key (tenant_id, user_id, day)
);

alter table public.tutor_usage_daily enable row level security;
alter table public.tutor_usage_daily force row level security;

-- El propio alumno (para que 5.8b le muestre su consumo) o staff del tenant
-- (panel de uso, 5.8b).
create policy tutor_usage_daily_select on public.tutor_usage_daily
  for select to authenticated
  using (
    public.is_superadmin()
    or (
      tenant_id = public.jwt_tenant_id()
      and (
        user_id = (select auth.uid())
        or public.has_role('otec_admin') or public.has_role('coordinator') or public.has_role('instructor')
      )
    )
  );

grant select on public.tutor_usage_daily to authenticated, service_role;
-- SIN insert/update para NADIE (ni authenticated ni service_role) a nivel de
-- tabla: toda escritura pasa por una de las 2 RPCs atómicas de más abajo
-- (`tutor_add_usage` para el propio alumno vía sesión, `tutor_add_usage_system`
-- para escrituras de sistema vía service_role) — ambas SECURITY DEFINER,
-- escriben con los privilegios de su dueño sin necesitar un GRANT de tabla
-- aparte (deny-by-default real).

-- ---------- upsert interno compartido (SIN grant propio; solo vía las 2 RPCs de abajo) ----------
-- Ambas RPCs (`tutor_add_usage`, `tutor_add_usage_system`) son SECURITY DEFINER
-- con el mismo dueño que esta función, así que pueden invocarla sin necesitar
-- un GRANT de EXECUTE explícito (Postgres resuelve la ejecución interna con el
-- rol dueño). No se otorga a `authenticated`/`service_role` a propósito: la
-- ÚNICA forma de llegar aquí es a través de una de las 2 puertas de arriba,
-- cada una con su propio contrato de autorización.
create or replace function public.tutor_upsert_usage_daily(
  p_tenant_id uuid,
  p_user_id uuid,
  p_day date,
  p_messages int,
  p_input_tokens bigint,
  p_output_tokens bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  insert into public.tutor_usage_daily (tenant_id, user_id, day, messages, input_tokens, output_tokens)
  values (p_tenant_id, p_user_id, p_day, coalesce(p_messages, 0), coalesce(p_input_tokens, 0), coalesce(p_output_tokens, 0))
  on conflict (tenant_id, user_id, day) do update set
    messages = public.tutor_usage_daily.messages + excluded.messages,
    input_tokens = public.tutor_usage_daily.input_tokens + excluded.input_tokens,
    output_tokens = public.tutor_usage_daily.output_tokens + excluded.output_tokens;
end;
$$;
revoke all on function public.tutor_upsert_usage_daily(uuid, uuid, date, int, bigint, bigint) from public;

-- ---------- RPC tutor_add_usage (upsert atómico, SOLO usuario autenticado) ----------
-- Hallazgo de revisión (5.8a, MED): la versión anterior solo validaba
-- `p_user_id`/`p_tenant_id` cuando `auth.uid() is not null`; llamada vía
-- `tenantGuard().db` (SIEMPRE service-role, confirmado contra
-- `src/lib/tenant-guard.ts`) `auth.uid()` es NULL y AMBOS checks se saltaban
-- por completo, aceptando cualquier `p_user_id`/`p_tenant_id`. `guard.db` es
-- el patrón dominante del repo (la ÚNICA puerta "permitida" al service-role) —
-- exactamente el que un endpoint de 5.8b tendería a usar por default, con
-- riesgo real de que un alumno infle/corrompa el contador de OTRO alumno.
-- Ahora el chequeo de identidad es INCONDICIONAL: sin `auth.uid()` (JWT real
-- de usuario), la función SIEMPRE rechaza. Cualquier endpoint de reporte de
-- uso del PROPIO alumno (5.8b) DEBE usar el cliente de sesión
-- (`createSupabaseServerClient()`, sujeto al JWT real — ver
-- `src/lib/supabase/server.ts`), nunca `guard.db`, para esta RPC.
create or replace function public.tutor_add_usage(
  p_tenant_id uuid,
  p_user_id uuid,
  p_day date,
  p_messages int,
  p_input_tokens bigint,
  p_output_tokens bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tenant_id is null or p_user_id is null or p_day is null then
    raise exception 'tutor_add_usage: parámetros obligatorios faltantes';
  end if;
  if auth.uid() is null then
    raise exception 'tutor_add_usage: requiere un usuario autenticado; las llamadas de sistema usan tutor_add_usage_system' using errcode = '42501';
  end if;
  if p_user_id is distinct from auth.uid() then
    raise exception 'tutor_add_usage: p_user_id no coincide con el usuario autenticado' using errcode = '42501';
  end if;
  if p_tenant_id is distinct from public.jwt_tenant_id() then
    raise exception 'tutor_add_usage: p_tenant_id no coincide con el tenant del usuario autenticado' using errcode = '42501';
  end if;

  perform public.tutor_upsert_usage_daily(p_tenant_id, p_user_id, p_day, p_messages, p_input_tokens, p_output_tokens);
end;
$$;
revoke all on function public.tutor_add_usage(uuid, uuid, date, int, bigint, bigint) from public;
-- SOLO `authenticated`: con el chequeo de `auth.uid()` ahora incondicional, un
-- caller `service_role` (sin JWT de usuario) SIEMPRE fallaría igual, así que
-- no se le concede el grant (deny-by-default explícito, no solo implícito).
grant execute on function public.tutor_add_usage(uuid, uuid, date, int, bigint, bigint) to authenticated;

-- ---------- RPC tutor_add_usage_system (escritura de sistema; SOLO service_role) ----------
-- Puerta EXPLÍCITA y separada para escrituras de uso que NO representan un
-- reporte del propio alumno vía sesión: seed/fixtures de test, y un futuro
-- backfill del worker (`tutor-maintenance.ts`) si hiciera falta. Sin chequeo
-- de `auth.uid()` porque, por diseño, nunca lo hay en esta ruta — la
-- seguridad la da el GRANT (solo `service_role`, que ya bypassa RLS por
-- convención del repo), no una validación de identidad de usuario.
create or replace function public.tutor_add_usage_system(
  p_tenant_id uuid,
  p_user_id uuid,
  p_day date,
  p_messages int,
  p_input_tokens bigint,
  p_output_tokens bigint
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if p_tenant_id is null or p_user_id is null or p_day is null then
    raise exception 'tutor_add_usage_system: parámetros obligatorios faltantes';
  end if;

  perform public.tutor_upsert_usage_daily(p_tenant_id, p_user_id, p_day, p_messages, p_input_tokens, p_output_tokens);
end;
$$;
revoke all on function public.tutor_add_usage_system(uuid, uuid, date, int, bigint, bigint) from public;
grant execute on function public.tutor_add_usage_system(uuid, uuid, date, int, bigint, bigint) to service_role;

-- ---------- tutor_tenant_budget (knob de plataforma/facturación) ----------
create table public.tutor_tenant_budget (
  tenant_id uuid primary key references public.tenants (id) on delete restrict,
  -- NULL = usa AI_MONTHLY_TOKEN_BUDGET_DEFAULT del env.
  monthly_token_budget bigint,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  updated_by uuid
);

create trigger tutor_tenant_budget_touch before update on public.tutor_tenant_budget
  for each row execute function public.touch_updated_at();

alter table public.tutor_tenant_budget enable row level security;
alter table public.tutor_tenant_budget force row level security;

-- Lectura: staff del tenant o superadmin. Escritura ("solo superadmin", es un
-- knob de plataforma/facturación y NO de la OTEC): se otorga a nivel de GRANT
-- a service_role, la autorización real la aplica la capa de servicio (mismo
-- patrón que el resto del repo: `service_role` bypassa RLS, así que
-- "solo superadmin" lo hace cumplir el código del servidor, no una policy).
create policy tutor_tenant_budget_select on public.tutor_tenant_budget
  for select to authenticated
  using (
    public.is_superadmin()
    or (tenant_id = public.jwt_tenant_id() and (public.has_role('otec_admin') or public.has_role('coordinator')))
  );

grant select on public.tutor_tenant_budget to authenticated;
grant select, insert, update on public.tutor_tenant_budget to service_role;

-- ---------- RPC search_course_chunks_lexical (FTS con ranking) ----------
-- `websearch_to_tsquery` + `ts_rank` no son expresables con el query builder
-- de supabase-js (`.textSearch()` no soporta ordenar por rank) → RPC SQL.
-- SECURITY DEFINER + `p_tenant_id` explícito (mismo estilo que `issue_certificate`):
-- se llama SIEMPRE vía `tenantGuard().db` (service-role, bypassa RLS), así que
-- el filtro de tenant real es este parámetro, no una policy. EXECUTE solo a
-- `service_role` — no está pensada para invocarse directo desde el cliente.
create or replace function public.search_course_chunks_lexical(
  p_tenant_id uuid,
  p_course_id uuid,
  p_query text,
  p_k int
)
returns table (
  chunk_index smallint,
  lesson_id uuid,
  lesson_title text,
  content text
)
language sql
stable
security definer
set search_path = ''
as $$
  select cc.chunk_index, cc.lesson_id, cc.lesson_title, cc.content
  from public.course_chunks cc
  where cc.tenant_id = p_tenant_id
    and cc.course_id = p_course_id
    and cc.content_tsv @@ websearch_to_tsquery('spanish', p_query)
  order by ts_rank(cc.content_tsv, websearch_to_tsquery('spanish', p_query)) desc
  limit greatest(coalesce(p_k, 6), 0)
$$;
revoke all on function public.search_course_chunks_lexical(uuid, uuid, text, int) from public;
grant execute on function public.search_course_chunks_lexical(uuid, uuid, text, int) to service_role;

-- ---------- RPC search_course_chunks_vector (similitud coseno, pgvector) ----------
create or replace function public.search_course_chunks_vector(
  p_tenant_id uuid,
  p_course_id uuid,
  p_embedding extensions.vector(1536),
  p_k int
)
returns table (
  chunk_index smallint,
  lesson_id uuid,
  lesson_title text,
  content text
)
language sql
stable
security definer
set search_path = ''
as $$
  select cc.chunk_index, cc.lesson_id, cc.lesson_title, cc.content
  from public.course_chunks cc
  where cc.tenant_id = p_tenant_id
    and cc.course_id = p_course_id
    and cc.embedding is not null
  order by cc.embedding OPERATOR(extensions.<=>) p_embedding
  limit greatest(coalesce(p_k, 6), 0)
$$;
revoke all on function public.search_course_chunks_vector(uuid, uuid, extensions.vector, int) from public;
grant execute on function public.search_course_chunks_vector(uuid, uuid, extensions.vector, int) to service_role;
