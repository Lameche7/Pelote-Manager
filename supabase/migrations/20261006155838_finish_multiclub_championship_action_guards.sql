begin;

create or replace function public.create_my_championship_match_reservation(target_match_id uuid, target_resource_id uuid, target_starts_at timestamp with time zone)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  settings public.club_reservation_settings%rowtype;
  target_ends_at timestamptz;
  target_club_id uuid;
  target_team_id uuid;
  target_championship_id uuid;
  target_status public.championship_status;
  match_payment_mode text;
  terms record;
  created_reservation public.reservations;
  match_label text;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select scoped_settings.*
  into strict settings
  from public.reservable_resources as resource
  join public.club_reservation_settings as scoped_settings
    on scoped_settings.club_id = resource.club_id
  where resource.id = target_resource_id
    and resource.is_active;

  target_ends_at := target_starts_at
    + make_interval(mins => settings.default_duration_minutes);

  select resource.club_id into target_club_id
  from public.reservable_resources as resource
  where resource.id = target_resource_id and resource.is_active;

  if target_club_id is null then
    raise exception 'La ressource demandée est indisponible' using errcode = 'P0001';
  end if;

  select
    case
      when public.championship_profile_can_act_for_team(match.team1_id, actor_id) then match.team1_id
      when public.championship_profile_can_act_for_team(match.team2_id, actor_id) then match.team2_id
      else null
    end,
    championship.id,
    championship.status,
    coalesce(policy.match_payment_mode, 'free'),
    concat_ws(' · ', championship.name, division.name,
      concat(team1.source_label, ' – ', team2.source_label))
  into target_team_id, target_championship_id, target_status,
       match_payment_mode, match_label
  from public.championship_matches as match
  join public.championship_divisions as division on division.id = match.division_id
  join public.championships as championship on championship.id = division.championship_id
  join public.championship_teams team1 on team1.id = match.team1_id
  join public.championship_teams team2 on team2.id = match.team2_id
  left join public.championship_reservation_settings policy
    on policy.club_id = target_club_id
  where match.id = target_match_id;

  if target_team_id is null or target_status not in ('preparation', 'active') then
    raise exception 'Cette rencontre ne peut pas être réservée depuis ce compte'
      using errcode = '42501';
  end if;

  if not public.championship_reservation_player_is_eligible(target_club_id, actor_id) then
    raise exception 'Vous ne bénéficiez pas de l’accès réservation championnat'
      using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    join public.championship_club_links as club_link
      on club_link.championship_id = target_championship_id
     and club_link.federation_club_id = federation_club.id
     and club_link.club_id = target_club_id
    where team.id = target_team_id
      and federation_club.linked_club_id = target_club_id
  ) then
    raise exception 'Championship match is not linked to this club' using errcode = '42501';
  end if;

  if exists (
    select 1 from public.reservations r
    where r.championship_match_id = target_match_id
      and r.status in ('pending', 'confirmed')
  ) then
    raise exception 'Cette rencontre possède déjà une réservation active'
      using errcode = '23505';
  end if;

  if match_payment_mode = 'standard' and settings.online_payment_enabled then
    raise exception 'CHAMPIONSHIP_PAYMENT_REQUIRED' using errcode = 'P0001';
  end if;

  select * into strict terms
  from public.assert_reservation_slot_allowed(
    target_resource_id, actor_id, target_starts_at, target_ends_at, null
  );

  if match_payment_mode = 'standard' then
    created_reservation := public.create_reservation_record(
      target_resource_id, target_starts_at, null, null, null
    );
  else
    insert into public.reservations (
      resource_id, user_id, customer_type, status, starts_at, ends_at,
      price_cents, payment_required, championship_match_id, created_by, updated_by
    ) values (
      target_resource_id, actor_id, terms.customer_type, 'confirmed',
      target_starts_at, target_ends_at, 0, false, target_match_id,
      actor_id, actor_id
    ) returning * into created_reservation;

    insert into public.calendar_occupations (
      resource_id, occupation_type, reservation_id, title,
      starts_at, ends_at, created_by, updated_by
    ) values (
      target_resource_id, 'reservation', created_reservation.id, match_label,
      target_starts_at, target_ends_at, actor_id, actor_id
    );
  end if;

  if match_payment_mode = 'standard' then
    update public.reservations
    set championship_match_id = target_match_id,
        updated_at = now(), updated_by = actor_id
    where id = created_reservation.id;

    update public.calendar_occupations
    set title = match_label, updated_at = now(), updated_by = actor_id
    where reservation_id = created_reservation.id and cancelled_at is null;
  end if;

  insert into public.reservation_audit_log (
    reservation_id, action, actor_id, new_data
  ) values (
    created_reservation.id, 'championship_match_created', actor_id,
    jsonb_build_object(
      'championship_match_id', target_match_id,
      'match_payment_mode', match_payment_mode,
      'payment_required', false,
      'price_cents', case when match_payment_mode = 'free' then 0 else created_reservation.price_cents end
    )
  );

  return jsonb_build_object(
    'reservation_id', created_reservation.id,
    'championship_match_id', target_match_id,
    'starts_at', target_starts_at,
    'ends_at', target_ends_at,
    'price_cents', case when match_payment_mode = 'free' then 0 else created_reservation.price_cents end,
    'payment_required', false
  );
exception
  when exclusion_violation then
    raise exception 'Ce créneau vient d''être réservé par une autre personne'
      using errcode = '23P01';
end;
$$;

create or replace function public.link_my_championship_match_reservation(target_match_id uuid, target_reservation_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_club_id uuid;
  target_team_id uuid;
  target_championship_id uuid;
  target_status public.championship_status;
  reservation_record public.reservations;
  label text;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select reservation.*
  into reservation_record
  from public.reservations as reservation
  where reservation.id = target_reservation_id
    and reservation.user_id = actor_id
    and reservation.status in ('pending', 'confirmed')
  for update;

  if reservation_record.id is null then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;

  select
    resource.club_id,
    case
      when public.championship_profile_can_act_for_team(match.team1_id, actor_id) then match.team1_id
      when public.championship_profile_can_act_for_team(match.team2_id, actor_id)
       and exists (
         select 1
         from public.championship_teams as away_team
         join public.championship_federation_clubs as away_club
           on away_club.id = away_team.federation_club_id
         join public.championship_match_club_venue_overrides as venue_override
           on venue_override.match_id = match.id
          and venue_override.club_id = away_club.linked_club_id
          and venue_override.enabled
         where away_team.id = match.team2_id
       ) then match.team2_id
      else null
    end,
    championship.id,
    championship.status,
    concat_ws(' · ', championship.name, division.name,
      concat(team1.source_label, ' – ', team2.source_label))
  into target_club_id, target_team_id, target_championship_id, target_status, label
  from public.championship_matches as match
  join public.championship_divisions as division on division.id = match.division_id
  join public.championships as championship on championship.id = division.championship_id
  join public.championship_teams as team1 on team1.id = match.team1_id
  join public.championship_teams as team2 on team2.id = match.team2_id
  join public.reservable_resources as resource on resource.id = reservation_record.resource_id
  where match.id = target_match_id;

  if target_team_id is null
    or target_championship_id is null
    or target_status not in ('preparation', 'active') then
    raise exception 'Championship match is not reservable by this user' using errcode = '42501';
  end if;

  if not exists (
    select 1
    from public.championship_teams as team
    join public.championship_federation_clubs as federation_club
      on federation_club.id = team.federation_club_id
    join public.championship_club_links as club_link
      on club_link.championship_id = target_championship_id
     and club_link.federation_club_id = federation_club.id
     and club_link.club_id = target_club_id
    where team.id = target_team_id
      and federation_club.linked_club_id = target_club_id
  ) then
    raise exception 'Championship match is not linked to this club' using errcode = '42501';
  end if;

  update public.reservations
  set championship_match_id = target_match_id,
      updated_at = now(),
      updated_by = actor_id
  where id = target_reservation_id;

  update public.calendar_occupations
  set title = label,
      updated_at = now(),
      updated_by = actor_id
  where reservation_id = target_reservation_id
    and cancelled_at is null;

  insert into public.reservation_audit_log (
    reservation_id, action, actor_id, new_data
  ) values (
    target_reservation_id,
    'championship_match_linked',
    actor_id,
    jsonb_build_object('championship_match_id', target_match_id)
  );

  return jsonb_build_object(
    'reservation_id', target_reservation_id,
    'championship_match_id', target_match_id
  );
exception
  when unique_violation then
    raise exception 'Cette rencontre possède déjà une réservation active'
      using errcode = '23505';
end;
$$;

create or replace function public.get_my_championship_reservation_context(target_match_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  result jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select jsonb_build_object(
    'match_id', match.id,
    'championship_id', championship.id,
    'championship_name', championship.name,
    'championship_status', championship.status,
    'division_id', division.id,
    'division_name', division.name,
    'display_color', division.display_color,
    'team1_label', team1.source_label,
    'team2_label', team2.source_label,
    'match_payment_mode', coalesce(reservation_policy.match_payment_mode, 'free'),
    'online_payment_enabled', coalesce(global_settings.online_payment_enabled, false),
    'existing_reservation', case
      when reservation.id is null then null
      else jsonb_build_object(
        'id', reservation.id,
        'resource_id', reservation.resource_id,
        'starts_at', reservation.starts_at,
        'ends_at', reservation.ends_at,
        'status', reservation.status
      )
    end
  )
  into result
  from public.championship_matches as match
  join public.championship_divisions as division on division.id = match.division_id
  join public.championships as championship on championship.id = division.championship_id
  join public.championship_teams as team1 on team1.id = match.team1_id
  join public.championship_teams as team2 on team2.id = match.team2_id
  join public.championship_federation_clubs as my_federation_club
    on my_federation_club.id = case
      when public.championship_profile_can_act_for_team(match.team1_id, actor_id)
        then team1.federation_club_id
      when public.championship_profile_can_act_for_team(match.team2_id, actor_id)
        then team2.federation_club_id
      else null
    end
  left join public.championship_club_links as club_link
    on club_link.championship_id = championship.id
   and club_link.federation_club_id = my_federation_club.id
  left join public.championship_reservation_settings as reservation_policy
    on reservation_policy.club_id = club_link.club_id
  left join public.club_reservation_settings as global_settings
    on global_settings.club_id = club_link.club_id
  left join lateral (
    select r.*
    from public.reservations as r
    where r.championship_match_id = match.id
      and r.status in ('pending', 'confirmed')
    order by r.created_at desc
    limit 1
  ) as reservation on true
  where match.id = target_match_id
    and championship.status in ('preparation', 'active')
    and (
      public.championship_profile_can_act_for_team(match.team1_id, actor_id)
      or (
        public.championship_profile_can_act_for_team(match.team2_id, actor_id)
        and exists (
          select 1
          from public.championship_teams as away_team
          join public.championship_federation_clubs as away_club
            on away_club.id = away_team.federation_club_id
          join public.championship_match_club_venue_overrides as venue_override
            on venue_override.match_id = match.id
           and venue_override.club_id = away_club.linked_club_id
           and venue_override.enabled
          where away_team.id = match.team2_id
        )
      )
    );

  if result is null then
    raise exception 'Championship match is not reservable by this user' using errcode = '42501';
  end if;

  return result;
end;
$$;

create or replace function public.submit_my_championship_result(target_match_id uuid, target_score_mine integer, target_score_opponent integer, target_comment text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  match_row public.championship_matches%rowtype;
  my_team_id uuid;
  canonical_score_team1 integer;
  canonical_score_team2 integer;
  submission_id uuid;
  championship_id uuid;
  result_input_mode text;
  result_winning_score integer;
  effective_starts_at timestamptz;
begin
  if actor_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  select match.* into match_row
  from public.championship_matches as match
  where match.id = target_match_id;

  if match_row.id is null then
    raise exception 'Championship match not found' using errcode = 'P0002';
  end if;

  select championship.id, championship.result_input_mode, championship.result_winning_score
  into championship_id, result_input_mode, result_winning_score
  from public.championship_divisions as division
  join public.championships as championship on championship.id = division.championship_id
  where division.id = match_row.division_id;

  if result_input_mode is null or result_winning_score is null then
    raise exception 'Result input settings not configured' using errcode = '22023';
  end if;

  if target_score_mine is null
    or target_score_opponent is null
    or target_score_mine not between 0 and 999
    or target_score_opponent not between 0 and 999
    or target_score_mine = target_score_opponent
    or greatest(target_score_mine, target_score_opponent) <> result_winning_score
    or least(target_score_mine, target_score_opponent) >= result_winning_score then
    raise exception 'Invalid score for championship settings' using errcode = '22023';
  end if;

  if match_row.status in ('cancelled', 'forfeit')
    or match_row.score_raw is not null
    or match_row.score_team1 is not null
    or match_row.score_team2 is not null then
    raise exception 'Official result already available or match unavailable' using errcode = '22023';
  end if;

  select effective.starts_at into effective_starts_at
  from public.championship_match_effective_schedule(target_match_id) as effective;

  if effective_starts_at is not null
    and effective_starts_at > now()
    and match_row.status <> 'played' then
    raise exception 'Match has not started' using errcode = '22023';
  end if;

  select team.id into my_team_id
  from public.championship_teams as team
  where team.id in (match_row.team1_id, match_row.team2_id)
    and public.championship_profile_can_act_for_team(team.id, actor_id)
  order by case when team.id = match_row.team1_id then 0 else 1 end
  limit 1;

  if my_team_id is null then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if my_team_id = match_row.team1_id then
    canonical_score_team1 := target_score_mine;
    canonical_score_team2 := target_score_opponent;
  else
    canonical_score_team1 := target_score_opponent;
    canonical_score_team2 := target_score_mine;
  end if;

  update public.championship_result_submissions as previous
  set status = 'withdrawn', resolved_at = now(), updated_at = now()
  where previous.match_id = target_match_id
    and previous.team_id = my_team_id
    and previous.status = 'pending';

  insert into public.championship_result_submissions (
    match_id, team_id, submitted_by, score_team1, score_team2, comment
  ) values (
    target_match_id, my_team_id, actor_id,
    canonical_score_team1, canonical_score_team2,
    nullif(btrim(target_comment), '')
  ) returning id into submission_id;

  insert into public.championship_audit_log (
    championship_id, actor_id, action, payload
  ) values (
    championship_id, actor_id, 'result_submission.created',
    jsonb_build_object(
      'submissionId', submission_id,
      'matchId', target_match_id,
      'teamId', my_team_id,
      'inputMode', result_input_mode,
      'winningScore', result_winning_score,
      'scoreTeam1', canonical_score_team1,
      'scoreTeam2', canonical_score_team2
    )
  );

  return jsonb_build_object(
    'id', submission_id,
    'matchId', target_match_id,
    'teamId', my_team_id,
    'scoreMine', target_score_mine,
    'scoreOpponent', target_score_opponent,
    'status', 'pending'
  );
end;
$$;

commit;
