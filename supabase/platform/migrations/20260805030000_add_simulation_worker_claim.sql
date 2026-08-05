-- Base CENTRALE de Pelote Manager uniquement.
-- Cette migration permet au worker de simulation de revendiquer exclusivement
-- des demandes appartenant à des clubs dont le slug utilise un préfixe réservé.

begin;

create or replace function public.platform_worker_claim_next_simulation_provisioning(
  new_worker_id text,
  expected_slug_prefix text default 'simulation-',
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
  normalized_slug_prefix text;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Accès réservé au service de provisionnement' using errcode = '42501';
  end if;

  if nullif(trim(new_worker_id), '') is null then
    raise exception 'L’identifiant du worker est obligatoire' using errcode = '22023';
  end if;

  normalized_slug_prefix := lower(trim(coalesce(expected_slug_prefix, '')));

  if normalized_slug_prefix !~ '^simulation-[a-z0-9-]*$' then
    raise exception 'Le préfixe de simulation est invalide' using errcode = '22023';
  end if;

  bounded_lease_seconds := greatest(
    60,
    least(coalesce(lease_duration_seconds, 300), 1800)
  );

  return query
  with candidate as (
    select jobs.id
    from public.platform_provisioning_jobs as jobs
    join public.platform_clubs as clubs on clubs.id = jobs.club_id
    where clubs.slug like normalized_slug_prefix || '%'
      and (
        jobs.status = 'pending'
        or (
          jobs.status = 'running'
          and jobs.lease_expires_at is not null
          and jobs.lease_expires_at < now()
        )
      )
    order by jobs.requested_at
    for update of jobs skip locked
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

revoke all on function public.platform_worker_claim_next_simulation_provisioning(
  text, text, integer
) from public, anon, authenticated;

grant execute on function public.platform_worker_claim_next_simulation_provisioning(
  text, text, integer
) to service_role;

commit;
