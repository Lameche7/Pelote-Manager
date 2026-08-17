begin;

-- Un navigateur peut renouveler son endpoint Web Push sans que l'ancien endpoint
-- soit immédiatement invalidé par le fournisseur. Le client conserve donc le
-- dernier endpoint connu de cette installation et le transmet lors de la
-- réinscription. On désactive cet ancien endpoint dans la même transaction que
-- l'enregistrement du nouveau.
--
-- Cette stratégie reste volontairement liée à l'endpoint précédent connu par
-- le navigateur : elle ne limite pas un profil à un seul appareil et préserve
-- donc téléphone + tablette + ordinateur.
create or replace function public.register_push_subscription_v2(
  target_endpoint text,
  target_p256dh text,
  target_auth text,
  target_user_agent text default null,
  target_platform text default null,
  target_previous_endpoint text default null
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  subscription_id uuid;
  current_endpoint text := nullif(btrim(target_endpoint), '');
  previous_endpoint text := nullif(btrim(target_previous_endpoint), '');
begin
  if actor_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  if current_endpoint is null
    or nullif(btrim(target_p256dh), '') is null
    or nullif(btrim(target_auth), '') is null
  then
    raise exception 'Abonnement push incomplet' using errcode = '22023';
  end if;

  if previous_endpoint is not null
    and previous_endpoint is distinct from current_endpoint
  then
    update public.push_subscriptions as subscription
    set
      is_active = false,
      updated_at = now()
    where subscription.profile_id = actor_id
      and subscription.endpoint = previous_endpoint
      and subscription.is_active;
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
    current_endpoint,
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

revoke all on function public.register_push_subscription_v2(
  text,
  text,
  text,
  text,
  text,
  text
) from public;

grant execute on function public.register_push_subscription_v2(
  text,
  text,
  text,
  text,
  text,
  text
) to authenticated;

commit;
