-- Draft: manual receipts, never a new independent club payment policy.
create table public.tournament_manual_receipts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  tournament_id uuid not null references public.tournaments(id) on delete restrict,
  team_id uuid not null references public.tournament_teams(id) on delete restrict,
  method text not null check (method in ('cash','cheque','bank_transfer')),
  amount_cents integer not null check (amount_cents>0),
  recorded_by uuid not null,
  recorded_at timestamptz not null default now(),
  request_id uuid not null unique
);
alter table public.tournament_manual_receipts enable row level security;
revoke all on public.tournament_manual_receipts from public,anon,authenticated;
-- A receipt records funds actually received, not a promise to pay.
create or replace function public.admin_record_tournament_manual_receipt_for_club(
  target_club_id uuid,target_tournament_id uuid,target_team_id uuid,
  payment_method text,received_cents integer,operation_id uuid
) returns uuid language plpgsql security definer set search_path=''
as $$
declare
  tournament_row public.tournaments%rowtype;
  team_row public.tournament_teams%rowtype;
  policy_row public.club_payment_policies%rowtype;
  existing public.tournament_manual_receipts%rowtype;
  receipt_id uuid;
  total_received bigint;
begin
  if auth.uid() is null or target_club_id is null or not coalesce(
    public.can_administer_club(target_club_id,'payments.manage')
    or pilotoki_private.has_active_platform_lease(auth.uid(),target_club_id),false
  ) then raise exception 'Access denied' using errcode='42501'; end if;
  select * into tournament_row from public.tournaments
    where id=target_tournament_id and club_id=target_club_id;
  if not found then raise exception 'Tournament not found' using errcode='42501'; end if;
  select * into team_row from public.tournament_teams
    where id=target_team_id and tournament_id=target_tournament_id for update;
  if not found then raise exception 'Team not found' using errcode='42501'; end if;
  if operation_id is null or received_cents is null or received_cents<=0
    or payment_method is null or payment_method not in ('cash','cheque','bank_transfer')
    then raise exception 'Invalid receipt' using errcode='22023'; end if;
  select * into existing from public.tournament_manual_receipts where request_id=operation_id;
  if found then
    if row(existing.club_id,existing.tournament_id,existing.team_id,existing.method,existing.amount_cents)
      is distinct from row(target_club_id,target_tournament_id,target_team_id,payment_method,received_cents)
      then raise exception 'Receipt request mismatch' using errcode='22023'; end if;
    return existing.id;
  end if;
  -- Require explicitly saved policy, and lock it while recording the receipt.
  select * into policy_row from public.club_payment_policies where club_id=target_club_id for share;
  if not found or not coalesce(case payment_method
    when 'cash' then policy_row.cash_enabled
    when 'cheque' then policy_row.cheque_enabled
    when 'bank_transfer' then policy_row.bank_transfer_enabled end,false)
    then raise exception 'Payment method disabled' using errcode='22023'; end if;
  if team_row.status not in ('pending','accepted') then
    raise exception 'Registration inactive' using errcode='22023';
  end if;
  if exists(select 1 from public.tournament_stripe_payment_attempts p
    where p.team_id=target_team_id and p.livemode and p.status in ('creating','open','processing','disputed'))
    then raise exception 'Stripe payment must be reconciled first' using errcode='22023'; end if;
  select coalesce((select sum(amount_cents) from public.tournament_manual_receipts where team_id=target_team_id),0)
    +coalesce((select sum(amount_cents) from public.tournament_stripe_payment_attempts
       where team_id=target_team_id and livemode and status='paid'),0) into total_received;
  if total_received+received_cents>team_row.registration_price_cents
    then raise exception 'Receipt exceeds outstanding registration fee' using errcode='22023'; end if;
  insert into public.tournament_manual_receipts(club_id,tournament_id,team_id,method,amount_cents,recorded_by,request_id)
    values(target_club_id,target_tournament_id,target_team_id,payment_method,received_cents,auth.uid(),operation_id)
    returning id into receipt_id;
  return receipt_id;
end;
$$;
revoke all on function public.admin_record_tournament_manual_receipt_for_club(uuid,uuid,uuid,text,integer,uuid) from public,anon,authenticated;
grant execute on function public.admin_record_tournament_manual_receipt_for_club(uuid,uuid,uuid,text,integer,uuid) to authenticated;
