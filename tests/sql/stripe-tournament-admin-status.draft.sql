-- Draft: read-only tournament payment overview for authorized club managers.
create or replace function public.admin_list_tournament_stripe_payments_for_club(
  target_club_id uuid, target_tournament_id uuid
) returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  tournament_row public.tournaments%rowtype;
begin
  if auth.uid() is null or target_club_id is null or not coalesce(
    public.can_administer_club(target_club_id,'payments.manage')
    or public.can_administer_club(target_club_id,'tournaments.manage')
    or pilotoki_private.has_active_platform_lease(auth.uid(),target_club_id),false
  ) then raise exception 'Access denied' using errcode='42501'; end if;
  select * into tournament_row from public.tournaments
    where id=target_tournament_id and club_id=target_club_id;
  if not found then raise exception 'Tournament not found' using errcode='42501'; end if;
  if not exists (
    select 1 from public.club_stripe_connections c
    where c.club_id=target_club_id and c.livemode and c.charges_enabled and c.verified_at is not null
  ) and not exists (
    select 1 from public.tournament_stripe_payment_attempts p
    where p.club_id=target_club_id and p.tournament_id=target_tournament_id and p.livemode
  ) then return null; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'team_id',t.id,'status',coalesce(p.status,'unpaid'),
      'amount_cents',coalesce(p.amount_cents,tournament_row.registration_fee_cents),
      'paid_at',p.paid_at
    ) order by t.id)
    from public.tournament_teams t
    left join lateral (
      select a.status,a.amount_cents,a.paid_at
      from public.tournament_stripe_payment_attempts a
      where a.team_id=t.id and a.club_id=target_club_id
        and a.tournament_id=target_tournament_id and a.livemode
      order by case when a.status in ('paid','disputed','processing','open','creating') then 0 else 1 end,
        a.created_at desc,a.id desc limit 1
    ) p on true
    where t.tournament_id=target_tournament_id
  ),'[]'::jsonb);
end;
$$;
revoke all on function public.admin_list_tournament_stripe_payments_for_club(uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_list_tournament_stripe_payments_for_club(uuid,uuid) to authenticated;
