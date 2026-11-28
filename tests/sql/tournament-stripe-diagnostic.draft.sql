-- Private diagnostic checkout: no tournament, team, reservation or real receipt.
create table public.tournament_stripe_diagnostic_attempts (
  id uuid primary key default gen_random_uuid(),
  club_id uuid not null references public.clubs(id) on delete restrict,
  actor_id uuid not null references auth.users(id) on delete restrict,
  stripe_account_id text not null check(stripe_account_id ~ '^acct_[A-Za-z0-9]+$'),
  amount_cents integer not null default 100 check(amount_cents=100),
  status text not null default 'creating' check(status in ('creating','open','processing','paid','expired')),
  stripe_session_id text unique,
  stripe_payment_intent_id text unique,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  check(status<>'paid' or (paid_at is not null and stripe_payment_intent_id is not null))
);
alter table public.tournament_stripe_diagnostic_attempts enable row level security;
revoke all on public.tournament_stripe_diagnostic_attempts from public,anon,authenticated;
grant select,insert,update on public.tournament_stripe_diagnostic_attempts to service_role;
create unique index tournament_stripe_diagnostic_active
  on public.tournament_stripe_diagnostic_attempts(club_id,actor_id)
  where status in ('creating','open','processing');

create or replace function public.prepare_tournament_stripe_diagnostic(target_club_id uuid,target_actor_id uuid)
returns jsonb language plpgsql security invoker set search_path='' as $$
declare
  c public.club_stripe_connections%rowtype;
  a public.tournament_stripe_diagnostic_attempts%rowtype;
begin
  if target_actor_id is null or not coalesce(pilotoki_private.has_active_platform_lease(target_actor_id,target_club_id),false) then
    raise exception 'Diagnostic access denied' using errcode='42501';
  end if;
  select * into c from public.club_stripe_connections
    where club_id=target_club_id and not livemode and charges_enabled and verified_at is not null for update;
  if not found then raise exception 'Test connection unavailable' using errcode='22023'; end if;
  select * into a from public.tournament_stripe_diagnostic_attempts
    where club_id=target_club_id and actor_id=target_actor_id and status in ('creating','open','processing')
    for update;
  if not found then
    insert into public.tournament_stripe_diagnostic_attempts(club_id,actor_id,stripe_account_id)
      values(target_club_id,target_actor_id,c.stripe_account_id) returning * into a;
  end if;
  if a.stripe_account_id<>c.stripe_account_id then
    raise exception 'Diagnostic account changed' using errcode='22023';
  end if;
  return to_jsonb(a);
end;
$$;
revoke all on function public.prepare_tournament_stripe_diagnostic(uuid,uuid) from public,anon,authenticated;
grant execute on function public.prepare_tournament_stripe_diagnostic(uuid,uuid) to service_role;

create or replace function public.get_my_tournament_stripe_diagnostic(target_club_id uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
  if auth.uid() is null or not coalesce(pilotoki_private.has_active_platform_lease(auth.uid(),target_club_id),false) then
    raise exception 'Diagnostic access denied' using errcode='42501';
  end if;
  return (select jsonb_build_object('status',a.status,'amount_cents',a.amount_cents,'paid_at',a.paid_at)
    from public.tournament_stripe_diagnostic_attempts a
    where a.club_id=target_club_id and a.actor_id=auth.uid()
    order by a.created_at desc,a.id desc limit 1);
end;
$$;
revoke all on function public.get_my_tournament_stripe_diagnostic(uuid) from public,anon,authenticated;
grant execute on function public.get_my_tournament_stripe_diagnostic(uuid) to authenticated;

-- Called only by the signature-verifying webhook, never by a browser.
create or replace function public.record_tournament_stripe_diagnostic(
  event_id text, account_id text, event_livemode boolean, attempt_id uuid,
  session_id text, intent_id text, paid_amount integer, paid_currency text, event_status text
) returns text language plpgsql security invoker set search_path='' as $$
declare
  a public.tournament_stripe_diagnostic_attempts%rowtype;
begin
  if event_livemode is distinct from false or event_id is null or event_id !~ '^evt_[A-Za-z0-9]+$'
    or session_id is null or session_id !~ '^cs_test_[A-Za-z0-9_]+$'
    or paid_amount is distinct from 100 or paid_currency is distinct from 'eur'
    or event_status is null or event_status not in ('paid','processing','expired')
    or (event_status='paid' and (intent_id is null or intent_id !~ '^pi_[A-Za-z0-9]+$')) then
    raise exception 'Invalid diagnostic event' using errcode='22023';
  end if;
  select * into a from public.tournament_stripe_diagnostic_attempts where id=attempt_id for update;
  if not found or a.stripe_account_id is distinct from account_id
    or (a.stripe_session_id is not null and a.stripe_session_id is distinct from session_id)
    or (a.stripe_payment_intent_id is not null and a.stripe_payment_intent_id is distinct from intent_id) then
    raise exception 'Diagnostic scope mismatch' using errcode='22023';
  end if;
  insert into public.stripe_processed_events(stripe_event_id,stripe_account_id,livemode)
    values(event_id,account_id,false) on conflict do nothing;
  if not found then return 'duplicate'; end if;
  if a.status='paid' or (a.status='expired' and event_status<>'paid') then return 'unchanged'; end if;
  update public.tournament_stripe_diagnostic_attempts
    set status=event_status,stripe_session_id=session_id,
      stripe_payment_intent_id=coalesce(intent_id,a.stripe_payment_intent_id),
      paid_at=case when event_status='paid' then now() else null end
    where id=attempt_id;
  return 'recorded';
end;
$$;
revoke all on function public.record_tournament_stripe_diagnostic(text,text,boolean,uuid,text,text,integer,text,text) from public,anon,authenticated;
grant execute on function public.record_tournament_stripe_diagnostic(text,text,boolean,uuid,text,text,integer,text,text) to service_role;

-- Server-only access to the already restricted lease helper.
grant usage on schema pilotoki_private to service_role;
