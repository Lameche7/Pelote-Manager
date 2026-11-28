-- Draft: refund ledger. No external transfer is made by this SQL.
create table public.tournament_payment_refunds (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  tournament_id uuid not null references public.tournaments(id) on delete restrict,
  team_id uuid not null references public.tournament_teams(id) on delete restrict,
  manual_receipt_id uuid references public.tournament_manual_receipts(id) on delete restrict,
  stripe_attempt_id uuid references public.tournament_stripe_payment_attempts(id) on delete restrict,
  amount_cents integer not null check(amount_cents>0),
  reason text not null check(length(btrim(reason)) between 1 and 500),
  requested_by uuid not null,
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  request_id uuid not null unique,
  stripe_refund_id text unique,
  status text not null check(status in ('requested','pending','succeeded','failed','cancelled')),
  check(num_nonnulls(manual_receipt_id,stripe_attempt_id)=1),
  check((status='succeeded')=(confirmed_at is not null)),
  check(manual_receipt_id is null or (status='succeeded' and stripe_refund_id is null))
);
alter table public.tournament_payment_refunds enable row level security;
revoke all on public.tournament_payment_refunds from public,anon,authenticated,service_role;

create or replace function public.admin_record_tournament_manual_refund_for_club(
  target_club_id uuid,target_tournament_id uuid,target_team_id uuid,
  target_receipt_id uuid,refund_cents integer,refund_reason text,operation_id uuid
) returns uuid language plpgsql security definer set search_path=''
as $$
declare
  receipt public.tournament_manual_receipts%rowtype;
  existing public.tournament_payment_refunds%rowtype;
  used_cents bigint;
  refund_id uuid;
begin
  if auth.uid() is null or target_club_id is null or not coalesce(
    public.can_administer_club(target_club_id,'payments.manage')
    or pilotoki_private.has_active_platform_lease(auth.uid(),target_club_id),false
  ) then raise exception 'Access denied' using errcode='42501'; end if;
  if operation_id is null or refund_cents is null or refund_cents<=0
    or refund_reason is null or length(btrim(refund_reason)) not between 1 and 500
    then raise exception 'Invalid refund' using errcode='22023'; end if;
  perform 1 from public.tournament_teams t join public.tournaments tr on tr.id=t.tournament_id
    where t.id=target_team_id and tr.id=target_tournament_id and tr.club_id=target_club_id for update of t;
  if not found then raise exception 'Registration not found' using errcode='42501'; end if;
  select * into receipt from public.tournament_manual_receipts
    where id=target_receipt_id and club_id=target_club_id
      and tournament_id=target_tournament_id and team_id=target_team_id for update;
  if not found then raise exception 'Receipt not found' using errcode='42501'; end if;
  select * into existing from public.tournament_payment_refunds where request_id=operation_id;
  if found then
    if row(existing.club_id,existing.tournament_id,existing.team_id,existing.manual_receipt_id,existing.amount_cents,existing.reason)
      is distinct from row(target_club_id,target_tournament_id,target_team_id,target_receipt_id,refund_cents,btrim(refund_reason))
      then raise exception 'Refund request mismatch' using errcode='22023'; end if;
    return existing.id;
  end if;
  select coalesce(sum(amount_cents),0) into used_cents from public.tournament_payment_refunds
    where manual_receipt_id=receipt.id and status in ('requested','pending','succeeded');
  if used_cents+refund_cents>receipt.amount_cents then
    raise exception 'Refund exceeds original receipt' using errcode='22023';
  end if;
  insert into public.tournament_payment_refunds(
    club_id,tournament_id,team_id,manual_receipt_id,amount_cents,reason,requested_by,
    request_id,status,confirmed_at
  ) values(target_club_id,target_tournament_id,target_team_id,target_receipt_id,
    refund_cents,btrim(refund_reason),auth.uid(),operation_id,'succeeded',now())
  returning id into refund_id;
  return refund_id;
end;
$$;
revoke all on function public.admin_record_tournament_manual_refund_for_club(uuid,uuid,uuid,uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.admin_record_tournament_manual_refund_for_club(uuid,uuid,uuid,uuid,integer,text,uuid) to authenticated;
