-- Base CENTRALE de Pelote Manager uniquement.
-- Cette migration prépare le suivi du provisionnement sans stocker aucun secret.

begin;

alter table public.platform_audit_log
  alter column actor_user_id drop not null;

alter table public.platform_audit_log
  add column if not exists actor_kind text not null default 'user'
    check (actor_kind in ('user', 'system'));

create table if not exists public.platform_provisioning_jobs (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.platform_clubs(id) on delete cascade,
  status text not null default 'pending'
    check (status in ('pending', 'running', 'waiting_external', 'completed', 'failed', 'cancelled')),
  current_step text not null default 'requested'
    check (
      current_step in (
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
      )
    ),
  requested_by uuid not null references auth.users(id) on delete restrict,
  requested_at timestamptz not null default now(),
  started_at timestamptz null,
  completed_at timestamptz null,
  last_error_message text null,
  updated_at timestamptz not null default now()
);

create unique index if not exists platform_provisioning_one_open_job_idx
  on public.platform_provisioning_jobs (club_id)
  where status in ('pending', 'running', 'waiting_external');

create index if not exists platform_provisioning_jobs_status_idx
  on public.platform_provisioning_jobs (status, requested_at desc);

alter table public.platform_provisioning_jobs enable row level security;

create policy "platform admins read provisioning jobs"
on public.platform_provisioning_jobs
for select
to authenticated
using (public.is_platform_admin());

create or replace function public.platform_list_provisioning_jobs()
returns table (
  id uuid,
  club_id uuid,
  status text,
  current_step text,
  requested_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  last_error_message text,
  updated_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  return query
  select
    jobs.id,
    jobs.club_id,
    jobs.status,
    jobs.current_step,
    jobs.requested_at,
    jobs.started_at,
    jobs.completed_at,
    jobs.last_error_message,
    jobs.updated_at
  from public.platform_provisioning_jobs as jobs
  order by jobs.requested_at desc;
end;
$$;

create or replace function public.platform_request_provisioning(
  target_club_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  requested_job_id uuid;
  existing_job_id uuid;
  target_club public.platform_clubs%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  select *
  into target_club
  from public.platform_clubs
  where id = target_club_id
  for update;

  if not found then
    raise exception 'Club introuvable' using errcode = 'P0002';
  end if;

  if target_club.status = 'cancelled' then
    raise exception 'Un club résilié ne peut pas être provisionné' using errcode = '22023';
  end if;

  if target_club.supabase_project_ref is not null
     or target_club.deployment_url is not null then
    raise exception 'Une instance technique est déjà rattachée à ce club' using errcode = '22023';
  end if;

  select jobs.id
  into existing_job_id
  from public.platform_provisioning_jobs as jobs
  where jobs.club_id = target_club_id
    and jobs.status in ('pending', 'running', 'waiting_external')
  order by jobs.requested_at desc
  limit 1;

  if existing_job_id is not null then
    return existing_job_id;
  end if;

  insert into public.platform_provisioning_jobs (
    club_id,
    requested_by
  ) values (
    target_club_id,
    auth.uid()
  )
  returning id into requested_job_id;

  insert into public.platform_audit_log (
    actor_user_id,
    actor_kind,
    action,
    target_club_id,
    details
  ) values (
    auth.uid(),
    'user',
    'provisioning.requested',
    target_club_id,
    jsonb_build_object('job_id', requested_job_id)
  );

  return requested_job_id;
end;
$$;

create or replace function public.platform_worker_update_provisioning(
  target_job_id uuid,
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

  update public.platform_provisioning_jobs
  set status = new_status,
      current_step = new_current_step,
      started_at = case
        when new_status in ('running', 'waiting_external', 'completed', 'failed')
          then coalesce(started_at, now())
        else started_at
      end,
      completed_at = case when new_status = 'completed' then now() else null end,
      last_error_message = case when new_status = 'failed' then nullif(trim(new_error_message), '') else null end,
      updated_at = now()
  where id = target_job_id
  returning club_id into target_club_id;

  if target_club_id is null then
    raise exception 'Provisionnement introuvable' using errcode = 'P0002';
  end if;

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
    'provisioning.updated',
    target_club_id,
    jsonb_build_object(
      'job_id', target_job_id,
      'status', new_status,
      'current_step', new_current_step
    )
  );
end;
$$;

create or replace function public.platform_update_club_status(
  target_club_id uuid,
  new_status text
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club public.platform_clubs%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  if new_status not in ('provisioning', 'trial', 'active', 'suspended', 'cancelled') then
    raise exception 'Le statut est invalide' using errcode = '22023';
  end if;

  select *
  into target_club
  from public.platform_clubs
  where id = target_club_id
  for update;

  if not found then
    raise exception 'Club introuvable' using errcode = 'P0002';
  end if;

  if new_status = 'active'
     and (
       target_club.supabase_project_ref is null
       or target_club.deployment_url is null
       or target_club.current_version is null
     ) then
    raise exception 'Le club ne peut pas être activé avant la fin du provisionnement' using errcode = '22023';
  end if;

  update public.platform_clubs
  set status = new_status,
      updated_at = now()
  where id = target_club_id;

  insert into public.platform_audit_log (
    actor_user_id,
    actor_kind,
    action,
    target_club_id,
    details
  ) values (
    auth.uid(),
    'user',
    'club.status_updated',
    target_club_id,
    jsonb_build_object('status', new_status)
  );
end;
$$;

revoke all on function public.platform_list_provisioning_jobs()
  from public, anon, authenticated;
revoke all on function public.platform_request_provisioning(uuid)
  from public, anon, authenticated;
revoke all on function public.platform_worker_update_provisioning(
  uuid, text, text, text, text, text, text, text, text
) from public, anon, authenticated;

grant execute on function public.platform_list_provisioning_jobs()
  to authenticated;
grant execute on function public.platform_request_provisioning(uuid)
  to authenticated;
grant execute on function public.platform_worker_update_provisioning(
  uuid, text, text, text, text, text, text, text, text
) to service_role;

commit;
