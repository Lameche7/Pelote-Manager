-- Preserve the exact accepted text, actor and timestamp in a private audit table.
create table if not exists pilotoki_private.tournament_rules_acceptances (
  id uuid primary key default gen_random_uuid(),
  team_id uuid not null references public.tournament_teams(id) on delete cascade,
  tournament_id uuid not null references public.tournaments(id) on delete cascade,
  actor_id uuid references public.profiles(id) on delete set null,
  rules_text text not null,
  accepted_at timestamptz not null default now()
);
alter table pilotoki_private.tournament_rules_acceptances enable row level security;
revoke all on pilotoki_private.tournament_rules_acceptances from public, anon, authenticated;
create index if not exists tournament_rules_acceptances_team_idx
  on pilotoki_private.tournament_rules_acceptances(team_id, accepted_at desc);

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
  current_rules text;
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

  select rules into current_rules from public.tournaments
    where id=target_tournament_id for share;
  if nullif(btrim(current_rules),'') is not null
    and (payload->>'accepted_rules') is distinct from current_rules then
    raise exception 'Tournament rules acceptance required or rules changed' using errcode='22023';
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

  if nullif(btrim(current_rules),'') is not null then
    insert into pilotoki_private.tournament_rules_acceptances
      (team_id, tournament_id, actor_id, rules_text)
    values (target_team_id, target_tournament_id, target_user_id, current_rules);
  end if;

  return target_team_id;
end;
$function$;
