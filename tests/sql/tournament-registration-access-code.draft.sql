-- Draft: tournament-specific priority registration, disabled by default.
create table if not exists pilotoki_private.tournament_registration_access (
  tournament_id uuid primary key references public.tournaments(id) on delete cascade,
  code_hash text not null,
  code_revision uuid not null default gen_random_uuid(),
  opens_public_at timestamptz,
  updated_at timestamptz not null default now()
);
alter table pilotoki_private.tournament_registration_access enable row level security;
revoke all on pilotoki_private.tournament_registration_access from public, anon, authenticated;

create or replace function public.admin_set_tournament_registration_access(
  target_tournament_id uuid, access_mode text, access_code text, public_at timestamptz
) returns void language plpgsql security definer set search_path = '' as $$
declare
  target_club uuid;
begin
  select club_id into target_club from public.tournaments where id=target_tournament_id for update;
  if auth.uid() is null or target_club is null or not coalesce(
    public.can_administer_club(target_club,'tournaments.manage')
    or pilotoki_private.has_active_platform_lease(auth.uid(),target_club),false
  ) then raise exception 'Access denied' using errcode='42501'; end if;
  if access_mode='free' then
    delete from pilotoki_private.tournament_registration_access where tournament_id=target_tournament_id;
    return;
  end if;
  if access_mode is null or access_mode not in ('locked','temporary')
    or (access_mode='temporary' and (public_at is null or public_at<=now()))
  then raise exception 'Invalid access mode or opening date' using errcode='22023'; end if;
  if access_code is not null and (char_length(btrim(access_code))<8 or octet_length(btrim(access_code))>72)
  then raise exception 'Access code must contain at least 8 characters and at most 72 bytes' using errcode='22023'; end if;
  if access_code is null then
    update pilotoki_private.tournament_registration_access set
      opens_public_at=case when access_mode='temporary' then public_at else null end,updated_at=now()
      where tournament_id=target_tournament_id;
    if not found then raise exception 'Access code required' using errcode='22023'; end if;
  else
    insert into pilotoki_private.tournament_registration_access(tournament_id,code_hash,opens_public_at)
    values(target_tournament_id,extensions.crypt(btrim(access_code),extensions.gen_salt('bf',10)),
      case when access_mode='temporary' then public_at else null end)
    on conflict(tournament_id) do update set code_hash=excluded.code_hash,code_revision=excluded.code_revision,
      opens_public_at=excluded.opens_public_at,updated_at=now();
  end if;
end; $$;
revoke all on function public.admin_set_tournament_registration_access(uuid,text,text,timestamptz) from public,anon;
grant execute on function public.admin_set_tournament_registration_access(uuid,text,text,timestamptz) to authenticated;

create or replace function public.get_tournament_registration_access(target_tournament_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'code_required', coalesce(a.tournament_id is not null and (a.opens_public_at is null or a.opens_public_at>now()),false),
    'opens_public_at', a.opens_public_at
  )
  from public.tournaments t left join pilotoki_private.tournament_registration_access a on a.tournament_id=t.id
  where t.id=target_tournament_id;
$$;
revoke all on function public.get_tournament_registration_access(uuid) from public,anon;
grant execute on function public.get_tournament_registration_access(uuid) to authenticated;

-- A successful code entry grants access only to this account and code revision.
create table if not exists pilotoki_private.tournament_registration_access_attempts (
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  actor_id uuid not null references public.profiles(id) on delete cascade,
  window_started_at timestamptz not null default now(),
  failed_attempts integer not null default 0 check (failed_attempts between 0 and 5),
  authorized_revision uuid,
  primary key (tournament_id,actor_id)
);
alter table pilotoki_private.tournament_registration_access_attempts enable row level security;
revoke all on pilotoki_private.tournament_registration_access_attempts from public,anon,authenticated;

create or replace function public.unlock_tournament_registration(
  target_tournament_id uuid, access_code text
) returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  actor uuid := auth.uid();
  policy pilotoki_private.tournament_registration_access;
  attempt pilotoki_private.tournament_registration_access_attempts;
begin
  if actor is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform 1 from public.tournaments where id=target_tournament_id for share;
  if not found then return jsonb_build_object('unlocked',false); end if;
  if not public.tournament_registration_is_open(target_tournament_id) then
    return jsonb_build_object('unlocked',false,'closed',true);
  end if;
  select * into policy from pilotoki_private.tournament_registration_access where tournament_id=target_tournament_id;
  if not found or (policy.opens_public_at is not null and policy.opens_public_at<=now()) then
    return jsonb_build_object('unlocked',true);
  end if;
  insert into pilotoki_private.tournament_registration_access_attempts(tournament_id,actor_id)
    values(target_tournament_id,actor) on conflict do nothing;
  select * into attempt from pilotoki_private.tournament_registration_access_attempts
    where tournament_id=target_tournament_id and actor_id=actor for update;
  if attempt.authorized_revision=policy.code_revision then
    return jsonb_build_object('unlocked',true);
  end if;
  if attempt.window_started_at<=now()-interval '15 minutes' then
    attempt.window_started_at:=now();
    attempt.failed_attempts:=0;
  end if;
  if attempt.failed_attempts>=5 then
    return jsonb_build_object('unlocked',false,'retry_at',attempt.window_started_at+interval '15 minutes');
  end if;
  if access_code is not null and octet_length(btrim(access_code)) between 8 and 72
    and extensions.crypt(btrim(access_code),policy.code_hash)=policy.code_hash then
    update pilotoki_private.tournament_registration_access_attempts
      set authorized_revision=policy.code_revision,failed_attempts=0,window_started_at=now()
      where tournament_id=target_tournament_id and actor_id=actor;
    return jsonb_build_object('unlocked',true);
  end if;
  update pilotoki_private.tournament_registration_access_attempts
    set failed_attempts=attempt.failed_attempts+1,window_started_at=attempt.window_started_at
    where tournament_id=target_tournament_id and actor_id=actor;
  -- Return rather than raise so the failed attempt is committed.
  return jsonb_build_object('unlocked',false,'remaining_attempts',4-attempt.failed_attempts,
    'retry_at',case when attempt.failed_attempts=4 then attempt.window_started_at+interval '15 minutes' else null end);
end; $$;
revoke all on function public.unlock_tournament_registration(uuid,text) from public,anon;
grant execute on function public.unlock_tournament_registration(uuid,text) to authenticated;

create or replace function pilotoki_private.require_tournament_registration_access(target_tournament_id uuid)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if auth.uid() is null then raise exception 'Authentication required' using errcode='42501'; end if;
  perform 1 from public.tournaments where id=target_tournament_id for share;
  if exists (
    select 1 from pilotoki_private.tournament_registration_access a
    where a.tournament_id=target_tournament_id
      and (a.opens_public_at is null or a.opens_public_at>now())
      and not exists (
        select 1 from pilotoki_private.tournament_registration_access_attempts v
        where v.tournament_id=a.tournament_id and v.actor_id=auth.uid()
          and v.authorized_revision=a.code_revision
      )
  ) then raise exception 'Tournament registration access code required' using errcode='42501'; end if;
end; $$;
revoke all on function pilotoki_private.require_tournament_registration_access(uuid) from public,anon,authenticated;
