-- Draft: short-lived, single-use OAuth state, bound to the initiating administrator and club.
create table public.tournament_stripe_oauth_states (
  state_hash text primary key check(state_hash ~ '^[0-9a-f]{64}$'),
  club_id uuid not null references public.clubs(id) on delete cascade,
  actor_id uuid not null,
  livemode boolean not null,
  expires_at timestamptz not null default (now()+interval '10 minutes'),
  consumed_at timestamptz
);
alter table public.tournament_stripe_oauth_states enable row level security;
revoke all on public.tournament_stripe_oauth_states from public,anon,authenticated;
grant select,insert,update on public.tournament_stripe_oauth_states to service_role;

create or replace function public.begin_tournament_stripe_oauth(
  target_club_id uuid,target_state_hash text,target_livemode boolean
) returns void language plpgsql security definer set search_path=''
as $$
begin
  if auth.uid() is null or target_club_id is null or not coalesce(
    public.can_administer_club(target_club_id,'payments.manage')
    or pilotoki_private.has_active_platform_lease(auth.uid(),target_club_id),false
  ) then raise exception 'Access denied' using errcode='42501'; end if;
  if target_state_hash is null or target_state_hash !~ '^[0-9a-f]{64}$'
    or target_livemode is null then raise exception 'Invalid state' using errcode='22023'; end if;
  insert into public.tournament_stripe_oauth_states(state_hash,club_id,actor_id,livemode)
    values(target_state_hash,target_club_id,auth.uid(),target_livemode);
end;
$$;

create or replace function public.consume_tournament_stripe_oauth(
  target_state_hash text,target_livemode boolean
) returns uuid language plpgsql security definer set search_path=''
as $$
declare
  target_club uuid;
begin
  if auth.uid() is null then raise exception 'Access denied' using errcode='42501'; end if;
  select club_id into target_club from public.tournament_stripe_oauth_states
    where state_hash=target_state_hash and actor_id=auth.uid() and livemode=target_livemode
      and consumed_at is null and expires_at>now() for update;
  if not found or not coalesce(
    public.can_administer_club(target_club,'payments.manage')
    or pilotoki_private.has_active_platform_lease(auth.uid(),target_club),false
  ) then raise exception 'Invalid or expired authorization' using errcode='42501'; end if;
  update public.tournament_stripe_oauth_states set consumed_at=now() where state_hash=target_state_hash;
  return target_club;
end;
$$;
revoke all on function public.begin_tournament_stripe_oauth(uuid,text,boolean) from public,anon,authenticated;
revoke all on function public.consume_tournament_stripe_oauth(text,boolean) from public,anon,authenticated;
grant execute on function public.begin_tournament_stripe_oauth(uuid,text,boolean) to authenticated;
grant execute on function public.consume_tournament_stripe_oauth(text,boolean) to authenticated;

-- Only the trusted callback can persist a verified account. Never replace
-- a different account or switch modes on an existing financial relationship.
alter table public.tournament_stripe_oauth_states add column completed_at timestamptz;
create or replace function public.complete_tournament_stripe_oauth(
  target_state_hash text,target_actor_id uuid,target_club_id uuid,
  target_livemode boolean,target_account_id text,target_charges_enabled boolean
) returns void language plpgsql security invoker set search_path=''
as $$
begin
  if target_account_id is null or target_account_id !~ '^acct_[A-Za-z0-9]+$'
    or target_charges_enabled is null then
    raise exception 'Invalid account' using errcode='22023';
  end if;
  perform 1 from public.tournament_stripe_oauth_states s
    where s.state_hash=target_state_hash and s.actor_id=target_actor_id
      and s.club_id=target_club_id and s.livemode=target_livemode
      and s.consumed_at is not null and s.completed_at is null and s.expires_at>now()
    for update;
  if not found then raise exception 'Invalid authorization' using errcode='42501'; end if;
  insert into public.club_stripe_connections(club_id,stripe_account_id,livemode,charges_enabled,verified_at)
    values(target_club_id,target_account_id,target_livemode,target_charges_enabled,now())
  on conflict(club_id) do update set charges_enabled=excluded.charges_enabled,verified_at=excluded.verified_at
    where club_stripe_connections.stripe_account_id=excluded.stripe_account_id
      and club_stripe_connections.livemode=excluded.livemode;
  if not found then raise exception 'Existing connection requires reconciliation' using errcode='22023'; end if;
  update public.tournament_stripe_oauth_states set completed_at=now() where state_hash=target_state_hash;
end;
$$;
revoke all on function public.complete_tournament_stripe_oauth(text,uuid,uuid,boolean,text,boolean) from public,anon,authenticated;
grant execute on function public.complete_tournament_stripe_oauth(text,uuid,uuid,boolean,text,boolean) to service_role;
