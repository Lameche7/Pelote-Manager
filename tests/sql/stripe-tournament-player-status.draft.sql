-- Draft: owner-only payment summary. Test transactions must never appear as real payments.
create or replace function public.get_my_tournament_stripe_payment(target_team_id uuid)
returns jsonb language plpgsql stable security definer set search_path = ''
as $$
declare
  team_row public.tournament_teams%rowtype;
  tournament_row public.tournaments%rowtype;
  payment public.tournament_stripe_payment_attempts%rowtype;
  available boolean;
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
  available := exists (
    select 1 from public.club_stripe_connections c
      where c.club_id=tournament_row.club_id and c.livemode
        and c.charges_enabled and c.verified_at is not null
  ) and coalesce(tournament_row.registration_fee_cents,0)>0;
  if not available and payment.id is null then return null; end if;
  return jsonb_build_object(
    'status',coalesce(payment.status,'unpaid'),
    'amount_cents',coalesce(payment.amount_cents,tournament_row.registration_fee_cents),
    'can_pay',available and team_row.status in ('pending','accepted')
      and coalesce(public.tournament_registration_is_open(tournament_row.id),false)
      and coalesce(payment.status,'unpaid') in ('unpaid','creating','open','expired','failed'),
    'paid_at',payment.paid_at
  );
end;
$$;
revoke all on function public.get_my_tournament_stripe_payment(uuid) from public,anon,authenticated;
grant execute on function public.get_my_tournament_stripe_payment(uuid) to authenticated;
