begin;

-- PR65 refinement — registration UX and contact integrity.
-- The public form uses the tournament play windows as checkbox choices,
-- resolves licensed players from the club registry and requires a usable
-- e-mail + phone for both players when the registry cannot provide them.

create or replace function public.get_public_tournament(target_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid;
  result jsonb;
begin
  select tournament.club_id
  into target_club_id
  from public.tournaments as tournament
  where tournament.id = target_id;

  if target_club_id is null then
    return null;
  end if;

  perform public.sync_tournament_registration_states(target_club_id);

  select jsonb_build_object(
    'id', tournament.id,
    'name', tournament.name,
    'description', tournament.description,
    'rules', tournament.rules,
    'starts_on', tournament.starts_on,
    'ends_on', tournament.ends_on,
    'registration_opens_at', tournament.registration_opens_at,
    'registration_closes_at', tournament.registration_closes_at,
    'status', tournament.status,
    'can_register', public.tournament_registration_is_open(tournament.id),
    'series', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', series.id,
            'name', series.name,
            'capacity', series.capacity,
            'accepted_count', (
              select count(*)
              from public.tournament_teams as accepted_team
              where accepted_team.series_id = series.id
                and accepted_team.status = 'accepted'
            ),
            'remaining_slots', greatest(
              series.capacity - public.tournament_series_reserved_count(series.id, null),
              0
            )
          )
          order by series.display_order, series.name
        ),
        '[]'::jsonb
      )
      from public.tournament_series as series
      where series.tournament_id = tournament.id
        and series.enabled
    ),
    'play_windows', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', play_window.id,
            'weekday', play_window.weekday,
            'opens_at', play_window.opens_at,
            'closes_at', play_window.closes_at
          )
          order by play_window.display_order, play_window.weekday, play_window.opens_at
        ),
        '[]'::jsonb
      )
      from public.tournament_play_windows as play_window
      where play_window.tournament_id = tournament.id
    ),
    'teams', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'id', team.id,
            'series_id', team.series_id,
            'series_name', series.name,
            'players', (
              select coalesce(
                jsonb_agg(
                  jsonb_build_object(
                    'first_name', player.first_name,
                    'last_name', player.last_name,
                    'role', player.role
                  )
                  order by player.display_order
                ),
                '[]'::jsonb
              )
              from public.tournament_team_players as player
              where player.team_id = team.id
            )
          )
          order by series.display_order, team.registered_at, team.id
        ),
        '[]'::jsonb
      )
      from public.tournament_teams as team
      join public.tournament_series as series on series.id = team.series_id
      where team.tournament_id = tournament.id
        and team.status = 'accepted'
    )
  )
  into result
  from public.tournaments as tournament
  where tournament.id = target_id
    and tournament.status not in ('preparation', 'configuration', 'cancelled');

  return result;
end;
$$;

create or replace function public.get_my_tournament_registration_identity(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := auth.uid();
  target_club_id uuid;
  current_profile public.profiles;
  current_member public.club_members;
begin
  if target_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select tournament.club_id
  into target_club_id
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  if target_club_id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  select profile.*
  into current_profile
  from public.profiles as profile
  where profile.id = target_user_id;

  if current_profile.id is null then
    raise exception 'Profile required' using errcode = '42501';
  end if;

  if current_profile.member_id is not null then
    select member.*
    into current_member
    from public.club_members as member
    where member.id = current_profile.member_id
      and member.club_id = target_club_id
      and member.is_active;
  end if;

  return jsonb_build_object(
    'member_id', current_member.id,
    'first_name', coalesce(
      nullif(btrim(current_member.first_name), ''),
      nullif(btrim(current_profile.first_name), ''),
      ''
    ),
    'last_name', coalesce(
      nullif(btrim(current_member.last_name), ''),
      nullif(btrim(current_profile.last_name), ''),
      ''
    ),
    'email', coalesce(
      nullif(btrim(current_member.email), ''),
      nullif(btrim(current_profile.email), ''),
      ''
    ),
    'phone', coalesce(nullif(btrim(current_member.phone), ''), ''),
    'email_from_member', nullif(btrim(current_member.email), '') is not null,
    'phone_from_member', nullif(btrim(current_member.phone), '') is not null
  );
end;
$$;

create or replace function public.search_tournament_partner_members(
  target_tournament_id uuid,
  search_text text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := auth.uid();
  target_club_id uuid;
  current_member_id uuid;
  normalized_search text := lower(btrim(coalesce(search_text, '')));
begin
  if target_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if length(normalized_search) < 2 then
    return '[]'::jsonb;
  end if;

  select tournament.club_id
  into target_club_id
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  if target_club_id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  select profile.member_id
  into current_member_id
  from public.profiles as profile
  where profile.id = target_user_id;

  return (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'id', candidate.id,
          'first_name', candidate.first_name,
          'last_name', candidate.last_name,
          'club_name', candidate.club_name,
          'has_email', candidate.has_email,
          'has_phone', candidate.has_phone
        )
        order by candidate.last_name, candidate.first_name
      ),
      '[]'::jsonb
    )
    from (
      select
        member.id,
        member.first_name,
        member.last_name,
        club.name as club_name,
        nullif(btrim(member.email), '') is not null as has_email,
        nullif(btrim(member.phone), '') is not null as has_phone
      from public.club_members as member
      join public.clubs as club on club.id = member.club_id
      where member.club_id = target_club_id
        and member.is_active
        and (current_member_id is null or member.id <> current_member_id)
        and lower(concat_ws(' ', member.first_name, member.last_name)) like '%' || normalized_search || '%'
      order by member.last_name, member.first_name
      limit 12
    ) as candidate
  );
end;
$$;

create or replace function public.get_my_tournament_registration(target_tournament_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_user_id uuid := auth.uid();
  result jsonb;
begin
  if target_user_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', team.id,
    'series_id', team.series_id,
    'status', team.status,
    'contact_email', team.contact_email,
    'contact_phone', team.contact_phone,
    'comments', team.comments,
    'players', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'member_id', player.member_id,
            'first_name', player.first_name,
            'last_name', player.last_name,
            'email', player.email,
            'phone', player.phone,
            'email_from_member', exists (
              select 1
              from public.club_members as member
              where member.id = player.member_id
                and nullif(btrim(member.email), '') is not null
            ),
            'phone_from_member', exists (
              select 1
              from public.club_members as member
              where member.id = player.member_id
                and nullif(btrim(member.phone), '') is not null
            ),
            'role', player.role
          )
          order by player.display_order
        ),
        '[]'::jsonb
      )
      from public.tournament_team_players as player
      where player.team_id = team.id
    ),
    'availability_rules', (
      select coalesce(
        jsonb_agg(
          jsonb_build_object(
            'kind', rule.kind,
            'weekday', rule.weekday,
            'starts_at', rule.starts_at,
            'ends_at', rule.ends_at
          )
          order by rule.display_order, rule.weekday, rule.starts_at
        ),
        '[]'::jsonb
      )
      from public.tournament_team_availability_rules as rule
      where rule.team_id = team.id
    )
  )
  into result
  from public.tournament_teams as team
  where team.tournament_id = target_tournament_id
    and team.submitted_by = target_user_id
    and team.status <> 'withdrawn'
  order by team.registered_at desc
  limit 1;

  return result;
end;
$$;

create or replace function public.save_my_tournament_registration(
  target_tournament_id uuid,
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
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

  if not public.tournament_series_has_capacity(target_series_id, existing_team.id) then
    raise exception 'Tournament series is full' using errcode = 'P0001';
  end if;

  if submitter_role not in ('front', 'back') then
    raise exception 'Tournament player role is invalid' using errcode = '22023';
  end if;
  partner_role := case when submitter_role = 'front' then 'back' else 'front' end;

  if current_profile.member_id is not null then
    select member.*
    into current_member
    from public.club_members as member
    where member.id = current_profile.member_id
      and member.club_id = target_club_id
      and member.is_active;
  end if;

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
$$;

revoke all on function public.get_public_tournament(uuid) from public;
revoke all on function public.get_my_tournament_registration_identity(uuid) from public, anon, authenticated;
revoke all on function public.search_tournament_partner_members(uuid, text) from public, anon, authenticated;
revoke all on function public.get_my_tournament_registration(uuid) from public;
revoke all on function public.save_my_tournament_registration(uuid, jsonb) from public;

grant execute on function public.get_public_tournament(uuid) to anon, authenticated;
grant execute on function public.get_my_tournament_registration_identity(uuid) to authenticated;
grant execute on function public.search_tournament_partner_members(uuid, text) to authenticated;
grant execute on function public.get_my_tournament_registration(uuid) to authenticated;
grant execute on function public.save_my_tournament_registration(uuid, jsonb) to authenticated;

commit;
