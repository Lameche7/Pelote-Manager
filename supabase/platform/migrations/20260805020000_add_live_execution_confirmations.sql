-- Base CENTRALE de Pelote Manager uniquement.
-- Cette migration prépare une confirmation renforcée avant toute future exécution réelle.
-- Elle n'active aucun appel Supabase Management API ou Vercel.

begin;

create table if not exists public.platform_live_execution_confirmations (
  id uuid primary key default gen_random_uuid(),
  provisioning_job_id uuid not null
    references public.platform_provisioning_jobs(id) on delete cascade,
  club_id uuid not null
    references public.platform_clubs(id) on delete cascade,
  plan_set_key text not null
    check (plan_set_key ~ '^live_[a-f0-9]{24}$'),
  currency text not null
    check (currency ~ '^[A-Z]{3}$'),
  one_time_cents bigint not null
    check (one_time_cents >= 0),
  monthly_cents bigint not null
    check (monthly_cents >= 0),
  current_plan_count integer not null
    check (current_plan_count > 0),
  confirmed_by uuid not null
    references auth.users(id) on delete restrict,
  confirmed_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  revoked_by uuid null
    references auth.users(id) on delete restrict,
  revoke_reason text null,
  consumed_at timestamptz null,
  created_at timestamptz not null default now(),
  check (expires_at > confirmed_at),
  check (
    (revoked_at is null and revoked_by is null)
    or revoked_at is not null
  )
);

create unique index if not exists platform_live_execution_one_active_idx
  on public.platform_live_execution_confirmations (provisioning_job_id)
  where revoked_at is null and consumed_at is null;

create index if not exists platform_live_execution_club_idx
  on public.platform_live_execution_confirmations (club_id, created_at desc);

alter table public.platform_live_execution_confirmations enable row level security;

create policy "platform admins read live confirmations"
on public.platform_live_execution_confirmations
for select
to authenticated
using (public.is_platform_admin());

create or replace function public.platform_live_execution_snapshot(
  target_job_id uuid
)
returns table (
  provisioning_job_id uuid,
  club_id uuid,
  club_slug text,
  plan_set_key text,
  currency text,
  one_time_cents bigint,
  monthly_cents bigint,
  current_plan_count integer,
  confirmation_phrase text
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_job public.platform_provisioning_jobs%rowtype;
  target_slug text;
  plan_count integer;
  currency_count integer;
  all_billable_plans_approved boolean;
  snapshot_currency text;
  snapshot_one_time_cents bigint;
  snapshot_monthly_cents bigint;
  snapshot_material text;
  snapshot_key text;
begin
  select jobs.*
  into target_job
  from public.platform_provisioning_jobs as jobs
  where jobs.id = target_job_id;

  if not found then
    raise exception 'Provisionnement introuvable' using errcode = 'P0002';
  end if;

  select clubs.slug
  into target_slug
  from public.platform_clubs as clubs
  where clubs.id = target_job.club_id;

  if not found then
    raise exception 'Club introuvable pour ce provisionnement' using errcode = 'P0002';
  end if;

  if target_job.status not in ('pending', 'running', 'waiting_external') then
    raise exception 'Ce provisionnement ne peut pas être confirmé pour une exécution réelle'
      using errcode = '22023';
  end if;

  with current_plans as (
    select
      plans.id,
      plans.plan_id,
      plans.provider,
      plans.step,
      plans.action,
      plans.creates_billable_resource,
      plans.currency,
      plans.one_time_cents,
      plans.monthly_cents,
      approvals.expires_at as approval_expires_at
    from public.platform_cost_plans as plans
    left join lateral (
      select approvals.expires_at
      from public.platform_cost_plan_approvals as approvals
      where approvals.cost_plan_id = plans.id
        and approvals.revoked_at is null
      order by approvals.approved_at desc
      limit 1
    ) as approvals on true
    where plans.provisioning_job_id = target_job_id
      and plans.superseded_at is null
  )
  select
    count(*)::integer,
    count(distinct current_plans.currency)::integer,
    coalesce(
      bool_and(
        not current_plans.creates_billable_resource
        or current_plans.approval_expires_at > now()
      ),
      false
    ),
    min(current_plans.currency),
    coalesce(sum(current_plans.one_time_cents), 0)::bigint,
    coalesce(sum(current_plans.monthly_cents), 0)::bigint,
    string_agg(
      concat_ws(
        '|',
        current_plans.plan_id,
        current_plans.provider,
        current_plans.step,
        current_plans.action,
        current_plans.creates_billable_resource::text,
        current_plans.currency,
        current_plans.one_time_cents::text,
        current_plans.monthly_cents::text
      ),
      '||' order by current_plans.plan_id
    )
  into
    plan_count,
    currency_count,
    all_billable_plans_approved,
    snapshot_currency,
    snapshot_one_time_cents,
    snapshot_monthly_cents,
    snapshot_material
  from current_plans;

  if plan_count = 0 then
    raise exception 'Aucun plan de coût courant n’est disponible'
      using errcode = '22023';
  end if;

  if currency_count <> 1 then
    raise exception 'Une confirmation réelle ne peut pas mélanger plusieurs devises'
      using errcode = '22023';
  end if;

  if not all_billable_plans_approved then
    raise exception 'Tous les plans facturables doivent être approuvés et non expirés'
      using errcode = '22023';
  end if;

  snapshot_key := 'live_' || left(md5(snapshot_material), 24);

  return query
  select
    target_job.id,
    target_job.club_id,
    target_slug,
    snapshot_key,
    snapshot_currency,
    snapshot_one_time_cents,
    snapshot_monthly_cents,
    plan_count,
    'CONFIRMER ' || target_slug || ' ' || right(snapshot_key, 8);
end;
$$;

create or replace function public.platform_preview_live_execution_confirmation(
  target_job_id uuid
)
returns table (
  provisioning_job_id uuid,
  club_id uuid,
  club_slug text,
  plan_set_key text,
  currency text,
  one_time_cents bigint,
  monthly_cents bigint,
  current_plan_count integer,
  confirmation_phrase text,
  validity_minutes integer
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
    snapshot.provisioning_job_id,
    snapshot.club_id,
    snapshot.club_slug,
    snapshot.plan_set_key,
    snapshot.currency,
    snapshot.one_time_cents,
    snapshot.monthly_cents,
    snapshot.current_plan_count,
    snapshot.confirmation_phrase,
    10
  from public.platform_live_execution_snapshot(target_job_id) as snapshot;
end;
$$;

create or replace function public.platform_confirm_live_execution(
  target_job_id uuid,
  expected_plan_set_key text,
  typed_club_slug text,
  typed_confirmation text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  snapshot record;
  confirmation_id uuid;
  confirmation_expires_at timestamptz := now() + interval '10 minutes';
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  select *
  into snapshot
  from public.platform_live_execution_snapshot(target_job_id);

  if expected_plan_set_key is distinct from snapshot.plan_set_key then
    raise exception 'Les plans ont changé : une nouvelle prévisualisation est obligatoire'
      using errcode = '22023';
  end if;

  if typed_club_slug is distinct from snapshot.club_slug then
    raise exception 'Le slug du club ne correspond pas exactement'
      using errcode = '22023';
  end if;

  if typed_confirmation is distinct from snapshot.confirmation_phrase then
    raise exception 'La phrase de confirmation ne correspond pas exactement'
      using errcode = '22023';
  end if;

  update public.platform_live_execution_confirmations
  set revoked_at = now(),
      revoked_by = auth.uid(),
      revoke_reason = 'Nouvelle confirmation renforcée'
  where provisioning_job_id = target_job_id
    and revoked_at is null
    and consumed_at is null;

  insert into public.platform_live_execution_confirmations (
    provisioning_job_id,
    club_id,
    plan_set_key,
    currency,
    one_time_cents,
    monthly_cents,
    current_plan_count,
    confirmed_by,
    expires_at
  ) values (
    snapshot.provisioning_job_id,
    snapshot.club_id,
    snapshot.plan_set_key,
    snapshot.currency,
    snapshot.one_time_cents,
    snapshot.monthly_cents,
    snapshot.current_plan_count,
    auth.uid(),
    confirmation_expires_at
  )
  returning id into confirmation_id;

  insert into public.platform_audit_log (
    actor_user_id,
    actor_kind,
    action,
    target_club_id,
    details
  ) values (
    auth.uid(),
    'user',
    'live_execution.confirmed',
    snapshot.club_id,
    jsonb_build_object(
      'confirmation_id', confirmation_id,
      'job_id', snapshot.provisioning_job_id,
      'plan_set_key', snapshot.plan_set_key,
      'currency', snapshot.currency,
      'one_time_cents', snapshot.one_time_cents,
      'monthly_cents', snapshot.monthly_cents,
      'current_plan_count', snapshot.current_plan_count,
      'expires_at', confirmation_expires_at
    )
  );

  return confirmation_id;
end;
$$;

create or replace function public.platform_list_live_execution_confirmations()
returns table (
  id uuid,
  provisioning_job_id uuid,
  club_id uuid,
  plan_set_key text,
  currency text,
  one_time_cents bigint,
  monthly_cents bigint,
  current_plan_count integer,
  lifecycle_status text,
  confirmed_at timestamptz,
  expires_at timestamptz
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
    confirmations.id,
    confirmations.provisioning_job_id,
    confirmations.club_id,
    confirmations.plan_set_key,
    confirmations.currency,
    confirmations.one_time_cents,
    confirmations.monthly_cents,
    confirmations.current_plan_count,
    case
      when confirmations.consumed_at is not null then 'consumed'
      when confirmations.revoked_at is not null then 'revoked'
      when confirmations.expires_at <= now() then 'expired'
      else 'confirmed'
    end,
    confirmations.confirmed_at,
    confirmations.expires_at
  from public.platform_live_execution_confirmations as confirmations
  order by confirmations.created_at desc;
end;
$$;

create or replace function public.platform_revoke_live_execution_confirmation(
  target_confirmation_id uuid,
  new_reason text default 'Révocation manuelle'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_confirmation public.platform_live_execution_confirmations%rowtype;
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  select *
  into target_confirmation
  from public.platform_live_execution_confirmations
  where id = target_confirmation_id
  for update;

  if not found then
    raise exception 'Confirmation renforcée introuvable' using errcode = 'P0002';
  end if;

  if target_confirmation.revoked_at is not null
     or target_confirmation.consumed_at is not null
     or target_confirmation.expires_at <= now() then
    raise exception 'Cette confirmation n’est plus active' using errcode = '22023';
  end if;

  update public.platform_live_execution_confirmations
  set revoked_at = now(),
      revoked_by = auth.uid(),
      revoke_reason = left(
        coalesce(nullif(trim(new_reason), ''), 'Révocation manuelle'),
        250
      )
  where id = target_confirmation_id;

  insert into public.platform_audit_log (
    actor_user_id,
    actor_kind,
    action,
    target_club_id,
    details
  ) values (
    auth.uid(),
    'user',
    'live_execution.revoked',
    target_confirmation.club_id,
    jsonb_build_object(
      'confirmation_id', target_confirmation.id,
      'job_id', target_confirmation.provisioning_job_id,
      'plan_set_key', target_confirmation.plan_set_key
    )
  );
end;
$$;

create or replace function public.platform_worker_get_live_execution_confirmation(
  target_job_id uuid,
  expected_plan_set_key text
)
returns table (
  confirmation_id uuid,
  provisioning_job_id uuid,
  club_id uuid,
  plan_set_key text,
  currency text,
  one_time_cents bigint,
  monthly_cents bigint,
  current_plan_count integer,
  confirmed_by uuid,
  confirmed_at timestamptz,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  snapshot record;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Accès réservé au service de provisionnement' using errcode = '42501';
  end if;

  select *
  into snapshot
  from public.platform_live_execution_snapshot(target_job_id);

  if expected_plan_set_key is distinct from snapshot.plan_set_key then
    raise exception 'La confirmation ne correspond plus aux plans courants'
      using errcode = '22023';
  end if;

  return query
  select
    confirmations.id,
    confirmations.provisioning_job_id,
    confirmations.club_id,
    confirmations.plan_set_key,
    confirmations.currency,
    confirmations.one_time_cents,
    confirmations.monthly_cents,
    confirmations.current_plan_count,
    confirmations.confirmed_by,
    confirmations.confirmed_at,
    confirmations.expires_at
  from public.platform_live_execution_confirmations as confirmations
  where confirmations.provisioning_job_id = target_job_id
    and confirmations.plan_set_key = snapshot.plan_set_key
    and confirmations.revoked_at is null
    and confirmations.consumed_at is null
    and confirmations.expires_at > now()
  order by confirmations.confirmed_at desc
  limit 1;

  if not found then
    raise exception 'Aucune confirmation renforcée active ne correspond aux plans courants'
      using errcode = 'P0002';
  end if;
end;
$$;

revoke all on table public.platform_live_execution_confirmations
  from public, anon, authenticated;

revoke all on function public.platform_live_execution_snapshot(uuid)
  from public, anon, authenticated;
revoke all on function public.platform_preview_live_execution_confirmation(uuid)
  from public, anon, authenticated;
revoke all on function public.platform_confirm_live_execution(uuid, text, text, text)
  from public, anon, authenticated;
revoke all on function public.platform_list_live_execution_confirmations()
  from public, anon, authenticated;
revoke all on function public.platform_revoke_live_execution_confirmation(uuid, text)
  from public, anon, authenticated;
revoke all on function public.platform_worker_get_live_execution_confirmation(uuid, text)
  from public, anon, authenticated;

revoke all on function public.platform_live_execution_snapshot(uuid)
  from service_role;
grant execute on function public.platform_preview_live_execution_confirmation(uuid)
  to authenticated;
grant execute on function public.platform_confirm_live_execution(uuid, text, text, text)
  to authenticated;
grant execute on function public.platform_list_live_execution_confirmations()
  to authenticated;
grant execute on function public.platform_revoke_live_execution_confirmation(uuid, text)
  to authenticated;
grant execute on function public.platform_worker_get_live_execution_confirmation(uuid, text)
  to service_role;

commit;
