-- Scoped original receipts and remaining refundable amounts; no provider credentials.
create or replace function public.admin_list_tournament_refund_sources_for_club(
  target_club_id uuid,target_tournament_id uuid,target_team_id uuid
) returns jsonb language plpgsql stable security definer set search_path=''
as $$
begin
  if auth.uid() is null or target_club_id is null or not coalesce(
    public.can_administer_club(target_club_id,'payments.manage')
    or pilotoki_private.has_active_platform_lease(auth.uid(),target_club_id),false
  ) then raise exception 'Access denied' using errcode='42501'; end if;
  if not exists(select 1 from public.tournament_teams t join public.tournaments tr on tr.id=t.tournament_id
    where t.id=target_team_id and tr.id=target_tournament_id and tr.club_id=target_club_id)
    then raise exception 'Registration not found' using errcode='42501'; end if;
  return coalesce((
    with sources as (
      select m.id,m.method,m.amount_cents,m.recorded_at as paid_at
      from public.tournament_manual_receipts m where m.club_id=target_club_id
        and m.tournament_id=target_tournament_id and m.team_id=target_team_id
      union all
      select p.id,'stripe',p.amount_cents,p.paid_at from public.tournament_stripe_payment_attempts p
      where p.club_id=target_club_id and p.tournament_id=target_tournament_id
        and p.team_id=target_team_id and p.livemode and p.status='paid'
        and p.stripe_payment_intent_id is not null
    )
    select jsonb_agg(jsonb_build_object('id',s.id,'method',s.method,'amount_cents',s.amount_cents,
      'paid_at',s.paid_at,'refunded_cents',f.confirmed,'pending_cents',f.pending,
      'refundable_cents',greatest(s.amount_cents-f.confirmed-f.pending,0),
      'pending_requests',f.requests) order by s.paid_at,s.id)
    from sources s cross join lateral (
      select coalesce(sum(r.amount_cents) filter(where r.status='succeeded'),0) as confirmed,
        coalesce(sum(r.amount_cents) filter(where r.status in ('requested','pending')),0) as pending,
        coalesce(jsonb_agg(jsonb_build_object('operation_id',r.request_id,'amount_cents',r.amount_cents,
          'reason',r.reason,'status',r.status) order by r.requested_at)
          filter(where r.status in ('requested','pending')),'[]'::jsonb) as requests
      from public.tournament_payment_refunds r
      where r.club_id=target_club_id and r.tournament_id=target_tournament_id and r.team_id=target_team_id
        and ((s.method='stripe' and r.stripe_attempt_id=s.id)
          or (s.method<>'stripe' and r.manual_receipt_id=s.id))
    ) f
  ),'[]'::jsonb);
end;
$$;
revoke all on function public.admin_list_tournament_refund_sources_for_club(uuid,uuid,uuid) from public,anon,authenticated;
grant execute on function public.admin_list_tournament_refund_sources_for_club(uuid,uuid,uuid) to authenticated;
