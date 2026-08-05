-- Base CENTRALE de Pelote Manager uniquement.
-- Cette migration stocke les plans de coût publics et leurs approbations.
-- Aucun secret fournisseur ne doit être enregistré dans ces tables.

begin;

create table if not exists public.platform_cost_plans (
  id uuid primary key default gen_random_uuid(),
  plan_id text not null unique
    check (plan_id ~ '^plan_[a-f0-9]{24}$'),
  provisioning_job_id uuid not null
    references public.platform_provisioning_jobs(id) on delete cascade,
  club_id uuid not null
    references public.platform_clubs(id) on delete cascade,
  provider text not null
    check (provider in ('supabase', 'vercel')),
  step text not null
    check (
      step in (
        'supabase_project',
        'database_migrations',
        'club_bootstrap',
        'first_admin',
        'vercel_project',
        'environment_variables',
        'deployment',
        'verification'
      )
    ),
  action text not null
    check (
      action in (
        'create_project',
        'apply_migrations',
        'bootstrap_club',
        'attach_first_admin',
        'configure_project',
        'deploy_application',
        'verify_instance'
      )
    ),
  idempotency_key text not null
    check (char_length(idempotency_key) between 10 and 250),
  creates_billable_resource boolean not null default false,
  currency text not null
    check (currency ~ '^[A-Z]{3}$'),
  one_time_cents bigint not null default 0
    check (one_time_cents >= 0),
  monthly_cents bigint not null default 0
    check (monthly_cents >= 0),
  public_summary text not null
    check (char_length(trim(public_summary)) between 5 and 500),
  superseded_at timestamptz null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provisioning_job_id, step, plan_id)
);

create index if not exists platform_cost_plans_club_idx
  on public.platform_cost_plans (club_id, created_at desc);

create index if not exists platform_cost_plans_job_step_idx
  on public.platform_cost_plans (provisioning_job_id, step, created_at desc);

create unique index if not exists platform_cost_plans_one_current_step_idx
  on public.platform_cost_plans (provisioning_job_id, step)
  where superseded_at is null;

create table if not exists public.platform_cost_plan_approvals (
  id uuid primary key default gen_random_uuid(),
  cost_plan_id uuid not null
    references public.platform_cost_plans(id) on delete cascade,
  approved_by uuid not null
    references auth.users(id) on delete restrict,
  approved_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz null,
  revoked_by uuid null
    references auth.users(id) on delete restrict,
  revoke_reason text null,
  created_at timestamptz not null default now(),
  check (expires_at > approved_at),
  check (
    (revoked_at is null and revoked_by is null)
    or revoked_at is not null
  )
);

create unique index if not exists platform_cost_plan_one_active_approval_idx
  on public.platform_cost_plan_approvals (cost_plan_id)
  where revoked_at is null;

create index if not exists platform_cost_plan_approvals_plan_idx
  on public.platform_cost_plan_approvals (cost_plan_id, approved_at desc);

alter table public.platform_cost_plans enable row level security;
alter table public.platform_cost_plan_approvals enable row level security;

create policy "platform admins read cost plans"
on public.platform_cost_plans
for select
to authenticated
using (public.is_platform_admin());

create policy "platform admins read cost approvals"
on public.platform_cost_plan_approvals
for select
to authenticated
using (public.is_platform_admin());

create or replace function public.platform_list_cost_plans()
returns table (
  id uuid,
  plan_id text,
  provisioning_job_id uuid,
  club_id uuid,
  provider text,
  step text,
  action text,
  creates_billable_resource boolean,
  currency text,
  one_time_cents bigint,
  monthly_cents bigint,
  public_summary text,
  lifecycle_status text,
  approved_at timestamptz,
  approval_expires_at timestamptz,
  created_at timestamptz
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
    plans.id,
    plans.plan_id,
    plans.provisioning_job_id,
    plans.club_id,
    plans.provider,
    plans.step,
    plans.action,
    plans.creates_billable_resource,
    plans.currency,
    plans.one_time_cents,
    plans.monthly_cents,
    plans.public_summary,
    case
      when plans.superseded_at is not null then 'superseded'
      when approvals.revoked_at is not null then 'revoked'
      when approvals.expires_at is not null and approvals.expires_at <= now() then 'expired'
      when approvals.expires_at is not null then 'approved'
      else 'pending'
    end as lifecycle_status,
    approvals.approved_at,
    approvals.expires_at,
    plans.created_at
  from public.platform_cost_plans as plans
  left join lateral (
    select
      approvals.approved_at,
      approvals.expires_at,
      approvals.revoked_at
    from public.platform_cost_plan_approvals as approvals
    where approvals.cost_plan_id = plans.id
    order by approvals.approved_at desc
    limit 1
  ) as approvals on true
  order by plans.created_at desc;
end;
$$;

create or replace function public.platform_worker_store_cost_plan(
  target_job_id uuid,
  new_plan_id text,
  new_provider text,
  new_step text,
  new_action text,
  new_idempotency_key text,
  new_creates_billable_resource boolean,
  new_currency text,
  new_one_time_cents bigint,
  new_monthly_cents bigint,
  new_public_summary text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  existing_plan public.platform_cost_plans%rowtype;
  stored_plan_id uuid;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Accès réservé au service de provisionnement' using errcode = '42501';
  end if;

  if new_plan_id !~ '^plan_[a-f0-9]{24}$' then
    raise exception 'Identifiant de plan invalide' using errcode = '22023';
  end if;

  if new_provider not in ('supabase', 'vercel') then
    raise exception 'Fournisseur de plan invalide' using errcode = '22023';
  end if;

  if new_step not in (
    'supabase_project',
    'database_migrations',
    'club_bootstrap',
    'first_admin',
    'vercel_project',
    'environment_variables',
    'deployment',
    'verification'
  ) then
    raise exception 'Étape de plan invalide' using errcode = '22023';
  end if;

  if (
    new_provider = 'supabase'
    and new_step not in (
      'supabase_project',
      'database_migrations',
      'club_bootstrap',
      'first_admin'
    )
  ) or (
    new_provider = 'vercel'
    and new_step not in (
      'vercel_project',
      'environment_variables',
      'deployment',
      'verification'
    )
  ) then
    raise exception 'Le fournisseur ne correspond pas à l’étape' using errcode = '22023';
  end if;

  if new_currency !~ '^[A-Z]{3}$' then
    raise exception 'Devise de plan invalide' using errcode = '22023';
  end if;

  if new_one_time_cents < 0 or new_monthly_cents < 0 then
    raise exception 'Un coût de plan ne peut pas être négatif' using errcode = '22023';
  end if;

  select jobs.club_id
  into target_club_id
  from public.platform_provisioning_jobs as jobs
  where jobs.id = target_job_id
  for update;

  if target_club_id is null then
    raise exception 'Provisionnement introuvable' using errcode = 'P0002';
  end if;

  select *
  into existing_plan
  from public.platform_cost_plans as plans
  where plans.plan_id = new_plan_id;

  if found then
    if existing_plan.provisioning_job_id <> target_job_id
       or existing_plan.club_id <> target_club_id
       or existing_plan.provider <> new_provider
       or existing_plan.step <> new_step
       or existing_plan.action <> new_action
       or existing_plan.idempotency_key <> new_idempotency_key
       or existing_plan.creates_billable_resource <> new_creates_billable_resource
       or existing_plan.currency <> new_currency
       or existing_plan.one_time_cents <> new_one_time_cents
       or existing_plan.monthly_cents <> new_monthly_cents
       or existing_plan.public_summary <> trim(new_public_summary) then
      raise exception 'Le plan existe déjà avec un contenu différent' using errcode = '23505';
    end if;

    return existing_plan.id;
  end if;

  update public.platform_cost_plans
  set superseded_at = now(),
      updated_at = now()
  where provisioning_job_id = target_job_id
    and step = new_step
    and superseded_at is null;

  update public.platform_cost_plan_approvals as approvals
  set revoked_at = now(),
      revoke_reason = 'Plan remplacé par une nouvelle estimation'
  where approvals.cost_plan_id in (
    select plans.id
    from public.platform_cost_plans as plans
    where plans.provisioning_job_id = target_job_id
      and plans.step = new_step
      and plans.superseded_at is not null
  )
    and approvals.revoked_at is null;

  insert into public.platform_cost_plans (
    plan_id,
    provisioning_job_id,
    club_id,
    provider,
    step,
    action,
    idempotency_key,
    creates_billable_resource,
    currency,
    one_time_cents,
    monthly_cents,
    public_summary
  ) values (
    new_plan_id,
    target_job_id,
    target_club_id,
    new_provider,
    new_step,
    new_action,
    trim(new_idempotency_key),
    new_creates_billable_resource,
    new_currency,
    new_one_time_cents,
    new_monthly_cents,
    trim(new_public_summary)
  )
  returning id into stored_plan_id;

  insert into public.platform_audit_log (
    actor_user_id,
    actor_kind,
    action,
    target_club_id,
    details
  ) values (
    null,
    'system',
    'cost_plan.recorded',
    target_club_id,
    jsonb_build_object(
      'cost_plan_id', stored_plan_id,
      'plan_id', new_plan_id,
      'job_id', target_job_id,
      'provider', new_provider,
      'step', new_step,
      'creates_billable_resource', new_creates_billable_resource,
      'currency', new_currency,
      'one_time_cents', new_one_time_cents,
      'monthly_cents', new_monthly_cents
    )
  );

  return stored_plan_id;
end;
$$;

create or replace function public.platform_approve_cost_plan(
  target_cost_plan_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_plan public.platform_cost_plans%rowtype;
  approval_id uuid;
  approval_expires_at timestamptz := now() + interval '1 hour';
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  select *
  into target_plan
  from public.platform_cost_plans
  where id = target_cost_plan_id
  for update;

  if not found then
    raise exception 'Plan de coût introuvable' using errcode = 'P0002';
  end if;

  if target_plan.superseded_at is not null then
    raise exception 'Un plan remplacé ne peut pas être approuvé' using errcode = '22023';
  end if;

  if not target_plan.creates_billable_resource then
    raise exception 'Ce plan ne nécessite aucune approbation de coût' using errcode = '22023';
  end if;

  update public.platform_cost_plan_approvals
  set revoked_at = now(),
      revoked_by = auth.uid(),
      revoke_reason = 'Nouvelle approbation explicite'
  where cost_plan_id = target_cost_plan_id
    and revoked_at is null;

  insert into public.platform_cost_plan_approvals (
    cost_plan_id,
    approved_by,
    expires_at
  ) values (
    target_cost_plan_id,
    auth.uid(),
    approval_expires_at
  )
  returning id into approval_id;

  insert into public.platform_audit_log (
    actor_user_id,
    actor_kind,
    action,
    target_club_id,
    details
  ) values (
    auth.uid(),
    'user',
    'cost_plan.approved',
    target_plan.club_id,
    jsonb_build_object(
      'cost_plan_id', target_plan.id,
      'plan_id', target_plan.plan_id,
      'provider', target_plan.provider,
      'step', target_plan.step,
      'currency', target_plan.currency,
      'one_time_cents', target_plan.one_time_cents,
      'monthly_cents', target_plan.monthly_cents,
      'expires_at', approval_expires_at
    )
  );

  return approval_id;
end;
$$;

create or replace function public.platform_revoke_cost_plan_approval(
  target_cost_plan_id uuid,
  new_reason text default 'Révocation manuelle'
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_plan public.platform_cost_plans%rowtype;
  revoked_count integer;
begin
  if not public.is_platform_admin() then
    raise exception 'Accès refusé' using errcode = '42501';
  end if;

  select *
  into target_plan
  from public.platform_cost_plans
  where id = target_cost_plan_id;

  if not found then
    raise exception 'Plan de coût introuvable' using errcode = 'P0002';
  end if;

  update public.platform_cost_plan_approvals
  set revoked_at = now(),
      revoked_by = auth.uid(),
      revoke_reason = left(coalesce(nullif(trim(new_reason), ''), 'Révocation manuelle'), 250)
  where cost_plan_id = target_cost_plan_id
    and revoked_at is null;

  get diagnostics revoked_count = row_count;

  if revoked_count = 0 then
    raise exception 'Aucune approbation active à révoquer' using errcode = 'P0002';
  end if;

  insert into public.platform_audit_log (
    actor_user_id,
    actor_kind,
    action,
    target_club_id,
    details
  ) values (
    auth.uid(),
    'user',
    'cost_plan.approval_revoked',
    target_plan.club_id,
    jsonb_build_object(
      'cost_plan_id', target_plan.id,
      'plan_id', target_plan.plan_id
    )
  );
end;
$$;

revoke all on table public.platform_cost_plans
  from public, anon, authenticated;
revoke all on table public.platform_cost_plan_approvals
  from public, anon, authenticated;

revoke all on function public.platform_list_cost_plans()
  from public, anon, authenticated;
revoke all on function public.platform_worker_store_cost_plan(
  uuid, text, text, text, text, text, boolean, text, bigint, bigint, text
) from public, anon, authenticated;
revoke all on function public.platform_approve_cost_plan(uuid)
  from public, anon, authenticated;
revoke all on function public.platform_revoke_cost_plan_approval(uuid, text)
  from public, anon, authenticated;

grant execute on function public.platform_list_cost_plans()
  to authenticated;
grant execute on function public.platform_worker_store_cost_plan(
  uuid, text, text, text, text, text, boolean, text, bigint, bigint, text
) to service_role;
grant execute on function public.platform_approve_cost_plan(uuid)
  to authenticated;
grant execute on function public.platform_revoke_cost_plan_approval(uuid, text)
  to authenticated;

commit;
