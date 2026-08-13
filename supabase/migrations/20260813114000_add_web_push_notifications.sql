create type public.push_delivery_status as enum (
  'pending',
  'sent',
  'failed',
  'invalid'
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete cascade,
  endpoint text not null unique,
  p256dh text not null,
  auth text not null,
  user_agent text,
  platform text,
  is_active boolean not null default true,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint push_subscriptions_endpoint_not_blank check (btrim(endpoint) <> ''),
  constraint push_subscriptions_p256dh_not_blank check (btrim(p256dh) <> ''),
  constraint push_subscriptions_auth_not_blank check (btrim(auth) <> '')
);

create index push_subscriptions_profile_active_idx
on public.push_subscriptions (profile_id, is_active, updated_at desc);

create table public.push_delivery_attempts (
  id uuid primary key default gen_random_uuid(),
  communication_id uuid not null references public.club_communications(id) on delete cascade,
  delivery_id uuid not null references public.communication_deliveries(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status public.push_delivery_status not null default 'pending',
  attempt_count integer not null default 0 check (attempt_count >= 0),
  response_status integer,
  error_message text,
  last_attempt_at timestamptz,
  sent_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (delivery_id, subscription_id)
);

create index push_delivery_attempts_communication_idx
on public.push_delivery_attempts (communication_id, status, created_at);

create index push_delivery_attempts_subscription_idx
on public.push_delivery_attempts (subscription_id, status, created_at desc);

alter table public.push_subscriptions enable row level security;
alter table public.push_delivery_attempts enable row level security;

create policy push_subscriptions_owner_read
on public.push_subscriptions
for select
to authenticated
using (profile_id = auth.uid());

create policy push_subscriptions_owner_delete
on public.push_subscriptions
for delete
to authenticated
using (profile_id = auth.uid());

create function public.register_push_subscription(
  target_endpoint text,
  target_p256dh text,
  target_auth text,
  target_user_agent text default null,
  target_platform text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  subscription_id uuid;
begin
  if actor_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  if nullif(btrim(target_endpoint), '') is null
    or nullif(btrim(target_p256dh), '') is null
    or nullif(btrim(target_auth), '') is null
  then
    raise exception 'Abonnement push incomplet' using errcode = '22023';
  end if;

  insert into public.push_subscriptions (
    profile_id,
    endpoint,
    p256dh,
    auth,
    user_agent,
    platform,
    is_active,
    last_error_at,
    last_error,
    updated_at
  ) values (
    actor_id,
    btrim(target_endpoint),
    btrim(target_p256dh),
    btrim(target_auth),
    nullif(btrim(target_user_agent), ''),
    nullif(btrim(target_platform), ''),
    true,
    null,
    null,
    now()
  )
  on conflict (endpoint)
  do update set
    profile_id = excluded.profile_id,
    p256dh = excluded.p256dh,
    auth = excluded.auth,
    user_agent = excluded.user_agent,
    platform = excluded.platform,
    is_active = true,
    last_error_at = null,
    last_error = null,
    updated_at = now()
  returning id into subscription_id;

  return subscription_id;
end;
$$;

revoke all on function public.register_push_subscription(text, text, text, text, text)
from public;
grant execute on function public.register_push_subscription(text, text, text, text, text)
to authenticated;

create function public.disable_push_subscription(target_endpoint text)
returns void
language plpgsql
security definer
set search_path = ''
as $$
begin
  if auth.uid() is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  update public.push_subscriptions as subscription
  set is_active = false,
      updated_at = now()
  where subscription.profile_id = auth.uid()
    and subscription.endpoint = target_endpoint;
end;
$$;

revoke all on function public.disable_push_subscription(text) from public;
grant execute on function public.disable_push_subscription(text) to authenticated;

create function public.list_my_push_subscriptions()
returns table (
  id uuid,
  endpoint text,
  platform text,
  is_active boolean,
  last_success_at timestamptz,
  last_error_at timestamptz,
  last_error text,
  created_at timestamptz,
  updated_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    subscription.id,
    subscription.endpoint,
    subscription.platform,
    subscription.is_active,
    subscription.last_success_at,
    subscription.last_error_at,
    subscription.last_error,
    subscription.created_at,
    subscription.updated_at
  from public.push_subscriptions as subscription
  where auth.uid() is not null
    and subscription.profile_id = auth.uid()
  order by subscription.updated_at desc;
$$;

revoke all on function public.list_my_push_subscriptions() from public;
grant execute on function public.list_my_push_subscriptions() to authenticated;

create function public.admin_get_push_health()
returns table (
  active_subscriptions integer,
  profiles_with_push integer,
  sent_last_24h integer,
  failed_last_24h integer
)
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not public.is_profile_admin() then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  return query
  select
    count(*) filter (where subscription.is_active)::integer,
    count(distinct subscription.profile_id) filter (where subscription.is_active)::integer,
    (
      select count(*)::integer
      from public.push_delivery_attempts as attempt
      where attempt.status = 'sent'
        and attempt.sent_at >= now() - interval '24 hours'
    ),
    (
      select count(*)::integer
      from public.push_delivery_attempts as attempt
      where attempt.status in ('failed', 'invalid')
        and attempt.last_attempt_at >= now() - interval '24 hours'
    )
  from public.push_subscriptions as subscription;
end;
$$;

revoke all on function public.admin_get_push_health() from public;
grant execute on function public.admin_get_push_health() to authenticated;
