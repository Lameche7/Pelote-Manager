-- Base CENTRALE de Pelote Manager uniquement.
-- Cette migration rend le worker de provisionnement exclusif, reprenable et idempotent.

begin;

alter table public.platform_provisioning_jobs
  add column if not exists attempt_count integer not null default 0,
  add column if not exists worker_id text null,
  add column if not exists lease_token uuid null,
  add column if not exists lease_expires_at timestamptz null,
  add column if not exists last_heartbeat_at timestamptz null;

create index if not exists platform_provisioning_jobs_lease_idx
  on public.platform_provisioning_jobs (status, lease_expires_at, requested_at);

drop function if exists public.platform_worker_update_provisioning(
  uuid, text, text, text, text, text, text, text, text
);

create or replace function public.platform_worker_claim_next_provisioning(
  new_worker_id text,
  lease_duration_seconds integer default 300
)
returns table (
  job_id uuid,
  club_id uuid,
  status text,
  current_step text,
  attempt_count integer,
  lease_token uuid,
  lease_expires_at timestamptz,
  club_name text,
  club_slug text,
  contact_email text,
  subscription_plan text,
  supabase_project_ref text,
  supabase_url text,
  vercel_project_name text,
  deployment_url text,
  current_version text
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  bounded_lease_seconds integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Accès réservé au service de provisionnement' using errcode = '42501';
  end if;

  if nullif(trim(new_worker_id), '') is null then
    raise exception 'L’identifiant du worker est obligatoire' using errcode = '22023';
  end if;

  bounded_lease_seconds := greatest(
    60,
    least(coalesce(lease_duration_seconds, 300), 1800)
  );

  return query
  with candidate as (
    select jobs.id
    from public.platform_provisioning_jobs as jobs
    where jobs.status = 'pending'
       or (
         jobs.status = 'running'
         and jobs.lease_expires_at is not null
         and jobs.lease_expires_at < now()
       )
    order by jobs.requested_at
    for update skip locked
    limit 1
  ), claimed as (
    update public.platform_provisioning_jobs as jobs
    set status = 'running',
        worker_id = trim(new_worker_id),
        lease_token = gen_random_uuid(),
        lease_expires_at = now() + make_interval(secs => bounded_lease_seconds),
        last_heartbeat_at = now(),
        attempt_count = jobs.attempt_count + 1,
        started_at = coalesce(jobs.started_at, now()),
        last_error_message = null,
        updated_at = now()
    from candidate
    where jobs.id = candidate.id
    returning jobs.*
  )
  select
    claimed.id,
    claimed.club_id,
    claimed.status,
    claimed.current_step,
    claimed.attempt_count,
    claimed.lease_token,
    claimed.lease_expires_at,
    clubs.name,
    clubs.slug,
    clubs.contact_email,
    clubs.subscription_plan,
    clubs.supabase_project_ref,
    clubs.supabase_url,
    clubs.vercel_project_name,
    clubs.deployment_url,
    clubs.current_version
  from claimed
  join public.platform_clubs as clubs on clubs.id = claimed.club_id;
end;
$$;

create or replace function public.platform_worker_heartbeat_provisioning(
  target_job_id uuid,
  expected_lease_token uuid,
  reported_current_step text,
  lease_duration_seconds integer default 300
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  bounded_lease_seconds integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Accès réservé au service de provisionnement' using errcode = '42501';
  end if;

  bounded_lease_seconds := greatest(
    60,
    least(coalesce(lease_duration_seconds, 300), 1800)
  );

  update public.platform_provisioning_jobs
  set current_step = reported_current_step,
      lease_expires_at = now() + make_interval(secs => bounded_lease_seconds),
      last_heartbeat_at = now(),
      updated_at = now()
  where id = target_job_id
    and status = 'running'
    and lease_token = expected_lease_token
    and lease_expires_at >= now();

  if not found then
    raise exception 'Le bail du provisionnement est absent, expiré ou remplacé' using errcode = '40001';
  end if;
end;
$$;

create or replace function public.platform_worker_update_provisioning(
  target_job_id uuid,
  expected_lease_token uuid,
  new_status text,
  new_current_step text,
  new_supabase_project_ref text default null,
  new_supabase_url text default null,
  new_vercel_project_name text default null,
  new_deployment_url text default null,
  new_current_version text default null,
  new_error_message text default null
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Accès réservé au service de provisionnement' using errcode = '42501';
  end if;

  if new_status not in ('pending', 'running', 'waiting_external', 'completed', 'failed', 'cancelled') then
    raise exception 'Le statut de provisionnement est invalide' using errcode = '22023';
  end if;

  if new_current_step not in (
    'requested',
    'supabase_project',
    'database_migrations',
    'club_bootstrap',
    'first_admin',
    'vercel_project',
    'environment_variables',
    'deployment',
    'verification',
    'completed'
  ) then
    raise exception 'L’étape de provisionnement est invalide' using errcode = '22023';
  end if;

  select jobs.club_id
  into target_club_id
  from public.platform_provisioning_jobs as jobs
  where jobs.id = target_job_id
    and jobs.status = 'running'
    and jobs.lease_token = expected_lease_token
    and jobs.lease_expires_at >= now()
  for update;

  if target_club_id is null then
    raise exception 'Le bail du provisionnement est absent, expiré ou remplacé' using errcode = '40001';
  end if;

  update public.platform_provisioning_jobs
  set status = new_status,
      current_step = new_current_step,
      completed_at = case when new_status = 'completed' then now() else null end,
      last_error_message = case
        when new_status = 'failed' then nullif(left(trim(new_error_message), 500), '')
        else null
      end,
      worker_id = case when new_status = 'running' then worker_id else null end,
      lease_token = case when new_status = 'running' then lease_token else null end,
      lease_expires_at = case when new_status = 'running' then lease_expires_at else null end,
      last_heartbeat_at = case when new_status = 'running' then now() else last_heartbeat_at end,
      updated_at = now()
  where id = target_job_id;

  update public.platform_clubs
  set supabase_project_ref = coalesce(nullif(trim(new_supabase_project_ref), ''), supabase_project_ref),
      supabase_url = coalesce(nullif(trim(new_supabase_url), ''), supabase_url),
      vercel_project_name = coalesce(nullif(trim(new_vercel_project_name), ''), vercel_project_name),
      deployment_url = coalesce(nullif(trim(new_deployment_url), ''), deployment_url),
      current_version = coalesce(nullif(trim(new_current_version), ''), current_version),
      status = case
        when new_status = 'completed' and status = 'provisioning' then 'trial'
        else status
      end,
      updated_at = now()
  where id = target_club_id;

  insert into public.platform_audit_log (
    actor_user_id,
    actor_kind,
    action,
    target_club_id,
    details
  ) values (
    null,
    'system',
    'provisioning.worker_updated',
    target_club_id,
    jsonb_build_object(
      'job_id', target_job_id,
      'status', new_status,
      'current_step', new_current_step
    )
  );
end;
$$;

revoke all on function public.platform_worker_claim_next_provisioning(text, integer)
  from public, anon, authenticated;
revoke all on function public.platform_worker_heartbeat_provisioning(uuid, uuid, text, integer)
  from public, anon, authenticated;
revoke all on function public.platform_worker_update_provisioning(
  uuid, uuid, text, text, text, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.platform_worker_claim_next_provisioning(text, integer)
  to service_role;
grant execute on function public.platform_worker_heartbeat_provisioning(uuid, uuid, text, integer)
  to service_role;
grant execute on function public.platform_worker_update_provisioning(
  uuid, uuid, text, text, text, text, text, text, text, text
) to service_role;

commit;
