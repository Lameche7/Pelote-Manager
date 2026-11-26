-- Draft: owner-only payment summary. Test transactions must never appear as real payments.
create or replace function public.get_my_tournament_stripe_payment(target_team_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  team_row public.tournament_teams%rowtype;
  tournament_row public.tournaments%rowtype;
  payment public.tournament_stripe_payment_attempts%rowtype;
  available boolean;
  manual_received bigint;
  remaining_cents bigint;
begin
  if auth.uid() is null or target_team_id is null then
    raise exception 'Authentication required' using errcode='42501';
  end if;
  select * into team_row from public.tournament_teams
    where id=target_team_id and submitted_by=auth.uid();
  if not found then return null; end if;
  select * into tournament_row from public.tournaments where id=team_row.tournament_id;
  if not found then return null; end if;
  select * into payment from public.tournament_stripe_payment_attempts
    where team_id=team_row.id and club_id=tournament_row.club_id
      and tournament_id=tournament_row.id and livemode
    order by case when status in ('paid','disputed','processing','open','creating') then 0 else 1 end,
      created_at desc, id desc limit 1;
  select coalesce(sum(amount_cents),0) into manual_received
    from public.tournament_manual_receipts where team_id=team_row.id
      and club_id=tournament_row.club_id and tournament_id=tournament_row.id;
  remaining_cents := greatest(team_row.registration_price_cents-manual_received
    -case when payment.status='paid' then payment.amount_cents else 0 end,0);
  available := exists (
    select 1 from public.club_stripe_connections c
      where c.club_id=tournament_row.club_id and c.livemode
        and c.charges_enabled and c.verified_at is not null
  ) and team_row.registration_price_cents>0;
  if not available and payment.id is null and manual_received=0 then return null; end if;
  return jsonb_build_object(
    'status',case when remaining_cents=0 and team_row.registration_price_cents>0 then 'paid' else coalesce(payment.status,'unpaid') end,
    'amount_cents',team_row.registration_price_cents,
    'remaining_cents',remaining_cents,
    'received_cents',team_row.registration_price_cents-remaining_cents,
    'can_pay',available and remaining_cents>0 and team_row.status in ('pending','accepted')
      and coalesce(public.tournament_registration_is_open(tournament_row.id),false)
      and coalesce(payment.status,'unpaid') in ('unpaid','creating','open','expired','failed'),
    'paid_at',payment.paid_at
  );
end;
$$;
revoke all on function public.get_my_tournament_stripe_payment(uuid) from public,anon,authenticated;
grant execute on function public.get_my_tournament_stripe_payment(uuid) to authenticated;
