-- Reserve refund amount before any Stripe API call. Only verified live receipts.
create or replace function public.admin_prepare_tournament_stripe_refund_for_club(
  target_club_id uuid,target_tournament_id uuid,target_team_id uuid,
  target_attempt_id uuid,refund_cents integer,refund_reason text,operation_id uuid
) returns uuid language plpgsql security definer set search_path=''
as $$
declare
  payment public.tournament_stripe_payment_attempts%rowtype;
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
  select * into payment from public.tournament_stripe_payment_attempts
    where id=target_attempt_id and club_id=target_club_id
      and tournament_id=target_tournament_id and team_id=target_team_id
      and livemode and status='paid' and stripe_payment_intent_id is not null for update;
  if not found then raise exception 'Confirmed live payment not found' using errcode='42501'; end if;
  select * into existing from public.tournament_payment_refunds where request_id=operation_id;
  if found then
    if row(existing.club_id,existing.tournament_id,existing.team_id,existing.stripe_attempt_id,existing.amount_cents,existing.reason)
      is distinct from row(target_club_id,target_tournament_id,target_team_id,target_attempt_id,refund_cents,btrim(refund_reason))
      then raise exception 'Refund request mismatch' using errcode='22023'; end if;
    return existing.id;
  end if;
  select coalesce(sum(amount_cents),0) into used_cents from public.tournament_payment_refunds
    where stripe_attempt_id=payment.id and status in ('requested','pending','succeeded');
  if used_cents+refund_cents>payment.amount_cents then
    raise exception 'Refund exceeds original payment' using errcode='22023'; end if;
  insert into public.tournament_payment_refunds(
    club_id,tournament_id,team_id,stripe_attempt_id,amount_cents,reason,requested_by,request_id,status
  ) values(target_club_id,target_tournament_id,target_team_id,target_attempt_id,
    refund_cents,btrim(refund_reason),auth.uid(),operation_id,'requested')
  returning id into refund_id;
  return refund_id;
end;
$$;
revoke all on function public.admin_prepare_tournament_stripe_refund_for_club(uuid,uuid,uuid,uuid,integer,text,uuid) from public,anon,authenticated;
grant execute on function public.admin_prepare_tournament_stripe_refund_for_club(uuid,uuid,uuid,uuid,integer,text,uuid) to authenticated;
