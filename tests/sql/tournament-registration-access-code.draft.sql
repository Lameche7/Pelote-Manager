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

create or replace function public.get_tournament_registration_access(target_tournament_id uuid)
returns jsonb language sql stable security definer set search_path = '' as $
  select jsonb_build_object(
    'code_required', coalesce(a.tournament_id is not null and (a.opens_public_at is null or a.opens_public_at>now()),false),
    'opens_public_at', a.opens_public_at,
    'unlocked', coalesce(exists (
      select 1 from pilotoki_private.tournament_registration_access_attempts v
      where v.tournament_id=t.id and v.actor_id=auth.uid()
        and v.authorized_revision=a.code_revision
    ),false)
  )
  from public.tournaments t left join pilotoki_private.tournament_registration_access a on a.tournament_id=t.id
  where t.id=target_tournament_id and auth.uid() is not null;
$;
revoke all on function public.get_tournament_registration_access(uuid) from public,anon;
grant execute on function public.get_tournament_registration_access(uuid) to authenticated;

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

-- All four public registration versions delegate to this existing implementation.
CREATE OR REPLACE FUNCTION public.save_my_tournament_registration(target_tournament_id uuid, payload jsonb)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  target_user_id uuid := auth.uid();
  target_club_id uuid;
  target_series_id uuid := nullif(payload->>'series_id', '')::uuid;
  target_team_id uuid;
  existing_team public.tournament_teams;
  current_profile public.profiles;
  current_member public.club_members;
  partner_member public.club_members;
  target_partner_member_id uuid := nullif(payload->>'partner_member_id', '')::uuid;
  submitter_role text := coalesce(payload->>'submitter_role', '');
  partner_role text;
  submitter_first_name text;
  submitter_last_name text;
  submitter_email text;
  submitter_phone text;
  partner_first_name text;
  partner_last_name text;
  partner_email text;
  partner_phone text;
  player_payload jsonb;
  availability_payload jsonb := coalesce(payload->'availability_rules', '[]'::jsonb);
  availability_item jsonb;
  availability_weekday integer;
  availability_starts_at time;
  availability_ends_at time;
  duplicate_window_count integer;
begin
  if target_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.id = target_user_id;

  if current_profile.id is null then
    raise exception 'Profile required' using errcode = '42501';
  end if;

  select tournament.club_id
  into target_club_id
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  if target_club_id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  perform public.sync_tournament_registration_states(target_club_id);

  if not public.tournament_registration_is_open(target_tournament_id) then
    raise exception 'Tournament registrations are closed' using errcode = 'P0001';
  end if;

  if target_series_id is null
    or not exists (
      select 1
      from public.tournament_series as series
      where series.id = target_series_id
        and series.tournament_id = target_tournament_id
        and series.enabled
    ) then
    raise exception 'Tournament series is invalid' using errcode = '22023';
  end if;

  select team.*
  into existing_team
  from public.tournament_teams as team
  where team.tournament_id = target_tournament_id
    and team.submitted_by = target_user_id
    and team.status <> 'withdrawn'
  order by team.registered_at desc
  limit 1
  for update;

  if existing_team.id is null then
    perform pilotoki_private.require_tournament_registration_access(target_tournament_id);
  end if;

  if not public.tournament_series_has_capacity(target_series_id, existing_team.id) then
    raise exception 'Tournament series is full' using errcode = 'P0001';
  end if;

  if submitter_role not in ('front', 'back') then
    raise exception 'Tournament player role is invalid' using errcode = '22023';
  end if;
  partner_role := case when submitter_role = 'front' then 'back' else 'front' end;

  select member.*
  into current_member
  from public.club_members as member
  where member.id = public.profile_club_member_id(current_profile.id, target_club_id);

  if target_partner_member_id is not null then
    select member.*
    into partner_member
    from public.club_members as member
    where member.id = target_partner_member_id
      and member.club_id = target_club_id
      and member.is_active;

    if partner_member.id is null
      or (current_member.id is not null and partner_member.id = current_member.id) then
      raise exception 'Tournament partner is invalid' using errcode = '22023';
    end if;
  end if;

  submitter_first_name := btrim(coalesce(
    nullif(current_member.first_name, ''),
    nullif(current_profile.first_name, ''),
    payload->>'submitter_first_name',
    ''
  ));
  submitter_last_name := btrim(coalesce(
    nullif(current_member.last_name, ''),
    nullif(current_profile.last_name, ''),
    payload->>'submitter_last_name',
    ''
  ));
  submitter_email := btrim(coalesce(
    nullif(current_member.email, ''),
    nullif(payload->>'contact_email', ''),
    nullif(current_profile.email, ''),
    ''
  ));
  submitter_phone := btrim(coalesce(
    nullif(current_member.phone, ''),
    nullif(payload->>'contact_phone', ''),
    ''
  ));

  partner_first_name := btrim(coalesce(
    nullif(partner_member.first_name, ''),
    payload->>'partner_first_name',
    ''
  ));
  partner_last_name := btrim(coalesce(
    nullif(partner_member.last_name, ''),
    payload->>'partner_last_name',
    ''
  ));
  partner_email := btrim(coalesce(
    nullif(partner_member.email, ''),
    nullif(payload->>'partner_email', ''),
    ''
  ));
  partner_phone := btrim(coalesce(
    nullif(partner_member.phone, ''),
    nullif(payload->>'partner_phone', ''),
    ''
  ));

  if submitter_first_name = ''
    or submitter_last_name = ''
    or partner_first_name = ''
    or partner_last_name = '' then
    raise exception 'Tournament registration fields are incomplete'
      using errcode = '22023';
  end if;

  if submitter_email = ''
    or submitter_phone = ''
    or partner_email = ''
    or partner_phone = '' then
    raise exception 'Tournament player contacts are incomplete'
      using errcode = '22023';
  end if;

  if jsonb_typeof(availability_payload) <> 'array' then
    raise exception 'Tournament availability rules are invalid'
      using errcode = '22023';
  end if;

  for availability_item in
    select value from jsonb_array_elements(availability_payload)
  loop
    availability_weekday := nullif(availability_item->>'weekday', '')::integer;
    availability_starts_at := nullif(availability_item->>'starts_at', '')::time;
    availability_ends_at := nullif(availability_item->>'ends_at', '')::time;

    if coalesce(availability_item->>'kind', '') not in ('preferred', 'possible', 'unavailable')
      or availability_weekday is null
      or availability_starts_at is null
      or availability_ends_at is null
      or not exists (
        select 1
        from public.tournament_play_windows as play_window
        where play_window.tournament_id = target_tournament_id
          and play_window.weekday = availability_weekday
          and play_window.opens_at = availability_starts_at
          and play_window.closes_at = availability_ends_at
      ) then
      raise exception 'Tournament availability rules are invalid'
        using errcode = '22023';
    end if;
  end loop;

  select count(*)
  into duplicate_window_count
  from (
    select
      value->>'weekday' as weekday,
      value->>'starts_at' as starts_at,
      value->>'ends_at' as ends_at
    from jsonb_array_elements(availability_payload)
    group by value->>'weekday', value->>'starts_at', value->>'ends_at'
    having count(*) > 1
  ) as duplicates;

  if duplicate_window_count > 0 then
    raise exception 'Tournament availability rules are invalid'
      using errcode = '22023';
  end if;

  if existing_team.id is null then
    insert into public.tournament_teams (
      tournament_id,
      series_id,
      status,
      contact_email,
      contact_phone,
      comments,
      submitted_by,
      created_by
    )
    values (
      target_tournament_id,
      target_series_id,
      'pending',
      submitter_email,
      submitter_phone,
      btrim(coalesce(payload->>'comments', '')),
      target_user_id,
      target_user_id
    )
    returning id into target_team_id;
  else
    target_team_id := existing_team.id;
    update public.tournament_teams
    set
      series_id = target_series_id,
      status = 'pending',
      contact_email = submitter_email,
      contact_phone = submitter_phone,
      comments = btrim(coalesce(payload->>'comments', '')),
      validated_by = null,
      validated_at = null,
      updated_at = now()
    where id = target_team_id;
  end if;

  player_payload := jsonb_build_array(
    jsonb_build_object(
      'member_id', current_member.id,
      'role', submitter_role,
      'first_name', submitter_first_name,
      'last_name', submitter_last_name,
      'email', submitter_email,
      'phone', submitter_phone
    ),
    jsonb_build_object(
      'member_id', partner_member.id,
      'role', partner_role,
      'first_name', partner_first_name,
      'last_name', partner_last_name,
      'email', partner_email,
      'phone', partner_phone
    )
  );

  perform public.save_tournament_team_children(
    target_team_id,
    target_tournament_id,
    target_club_id,
    player_payload,
    availability_payload
  );

  insert into public.tournament_audit_log (
    tournament_id,
    action,
    before_status,
    after_status,
    payload,
    created_by
  )
  values (
    target_tournament_id,
    case when existing_team.id is null then 'team_submitted' else 'team_resubmitted' end,
    (select status from public.tournaments where id = target_tournament_id),
    (select status from public.tournaments where id = target_tournament_id),
    jsonb_build_object(
      'team_id', target_team_id,
      'series_id', target_series_id,
      'partner_member_id', partner_member.id
    ),
    target_user_id
  );

  return target_team_id;
end;
$function$;
