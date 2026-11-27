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
