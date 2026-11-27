-- Explicit club preference, separate from the provider's verified connection.
alter table public.club_payment_policies add column stripe_tournament_enabled boolean not null default false;

create or replace function public.admin_get_tournament_stripe_policy_for_club(target_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if auth.uid() is null or target_club_id is null or not coalesce(
    public.can_administer_club(target_club_id,'settings.manage')
    or public.can_administer_club(target_club_id,'payments.manage')
    or pilotoki_private.has_active_platform_lease(auth.uid(),target_club_id),false
  ) then raise exception 'Access denied' using errcode='42501'; end if;
  return jsonb_build_object(
    'enabled',coalesce((select stripe_tournament_enabled from public.club_payment_policies where club_id=target_club_id),false),
    'connected',exists(select 1 from public.club_stripe_connections c
      where c.club_id=target_club_id and c.livemode and c.charges_enabled and c.verified_at is not null)
  );
end;
$$;

create or replace function public.admin_set_tournament_stripe_policy_for_club(target_club_id uuid,new_enabled boolean)
returns void language plpgsql security definer set search_path=''
as $$
begin
  if auth.uid() is null or target_club_id is null or not coalesce(
    public.can_administer_club(target_club_id,'payments.manage')
    or pilotoki_private.has_active_platform_lease(auth.uid(),target_club_id),false
  ) then raise exception 'Access denied' using errcode='42501'; end if;
  if new_enabled is null then raise exception 'Invalid Stripe preference' using errcode='22023'; end if;
  if new_enabled and not exists(select 1 from public.club_stripe_connections c
    where c.club_id=target_club_id and c.livemode and c.charges_enabled and c.verified_at is not null)
    then raise exception 'A verified Stripe connection is required' using errcode='22023'; end if;
  insert into public.club_payment_policies(club_id,stripe_tournament_enabled,updated_at,updated_by)
    values(target_club_id,new_enabled,now(),auth.uid())
  on conflict(club_id) do update set stripe_tournament_enabled=excluded.stripe_tournament_enabled,
    updated_at=excluded.updated_at,updated_by=excluded.updated_by;
end;
$$;
revoke all on function public.admin_get_tournament_stripe_policy_for_club(uuid) from public,anon,authenticated;
revoke all on function public.admin_set_tournament_stripe_policy_for_club(uuid,boolean) from public,anon,authenticated;
grant execute on function public.admin_get_tournament_stripe_policy_for_club(uuid) to authenticated;
grant execute on function public.admin_set_tournament_stripe_policy_for_club(uuid,boolean) to authenticated;

grant select on public.club_payment_policies to service_role;
