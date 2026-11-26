-- Draft, server-only checkout preparation. No network request or real charge.
create or replace function public.prepare_tournament_stripe_checkout(
  target_actor_id uuid, target_team_id uuid, expected_livemode boolean
) returns jsonb
language plpgsql security invoker set search_path = ''
as $$
declare
  team_row public.tournament_teams%rowtype;
  tournament_row public.tournaments%rowtype;
  connection_row public.club_stripe_connections%rowtype;
  attempt_row public.tournament_stripe_payment_attempts%rowtype;
begin
  if target_actor_id is null or target_team_id is null or expected_livemode is null then
    raise exception 'Checkout parameters required' using errcode = '22023';
  end if;
  select * into team_row from public.tournament_teams
    where id = target_team_id and submitted_by = target_actor_id for update;
  if not found or team_row.status not in ('pending','accepted') then
    raise exception 'Checkout unavailable' using errcode = '42501';
  end if;
  select * into tournament_row from public.tournaments
    where id = team_row.tournament_id for share;
  if not found or tournament_row.registration_fee_cents is null
    or tournament_row.registration_fee_cents <= 0
    or not coalesce(public.tournament_registration_is_open(tournament_row.id), false) then
    raise exception 'Checkout unavailable' using errcode = '22023';
  end if;
  select * into connection_row from public.club_stripe_connections
    where club_id = tournament_row.club_id and livemode = expected_livemode
      and charges_enabled and verified_at is not null for share;
  if not found then
    raise exception 'Stripe not connected' using errcode = '22023';
  end if;
  select * into attempt_row from public.tournament_stripe_payment_attempts
    where team_id = team_row.id and livemode = expected_livemode
      and status in ('creating','open','processing','paid','disputed') for update;
  if not found then
    insert into public.tournament_stripe_payment_attempts(
      club_id,tournament_id,team_id,stripe_account_id,livemode,amount_cents
    ) values (
      tournament_row.club_id,tournament_row.id,team_row.id,
      connection_row.stripe_account_id,expected_livemode,tournament_row.registration_fee_cents
    ) returning * into attempt_row;
  end if;
  return jsonb_build_object(
    'attempt_id',attempt_row.id,'club_id',attempt_row.club_id,
    'tournament_id',attempt_row.tournament_id,'team_id',attempt_row.team_id,
    'stripe_account_id',attempt_row.stripe_account_id,
    'livemode',attempt_row.livemode,'amount_cents',attempt_row.amount_cents,
    'currency',attempt_row.currency,'status',attempt_row.status,
    'stripe_session_id',attempt_row.stripe_session_id
  );
end;
$$;
revoke all on function public.prepare_tournament_stripe_checkout(uuid,uuid,boolean) from public, anon, authenticated;
grant execute on function public.prepare_tournament_stripe_checkout(uuid,uuid,boolean) to service_role;
