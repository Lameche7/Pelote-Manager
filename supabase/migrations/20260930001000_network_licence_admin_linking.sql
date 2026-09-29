begin;

create or replace function public.admin_preview_profile_licence_link(
  target_profile_id uuid,
  target_licence_number text
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_club uuid := public.admin_current_club_id();
  canonical_licence text;
  profile_row public.profiles%rowtype;
  player_row public.sport_players%rowtype;
  member_row public.club_members%rowtype;
  season_row public.club_seasons%rowtype;
  affiliation_row public.sport_player_club_affiliations%rowtype;
  linked_profile_id uuid;
  other_affiliations jsonb := '[]'::jsonb;
  licensed_this_season boolean := false;
begin
  if current_club is null
    or not public.has_club_permission(current_club, 'members.manage')
  then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  canonical_licence := regexp_replace(
    coalesce(target_licence_number, ''),
    '[^0-9]+',
    '',
    'g'
  );

  if canonical_licence = '' or length(canonical_licence) > 6 then
    raise exception 'Numéro de licence invalide' using errcode = '22023';
  end if;

  canonical_licence := lpad(canonical_licence, 6, '0');

  select *
  into profile_row
  from public.profiles
  where id = target_profile_id;

  if profile_row.id is null then
    raise exception 'Compte PILOTOKI introuvable' using errcode = 'P0002';
  end if;

  select *
  into season_row
  from public.club_seasons
  where club_id = current_club
    and is_active
  order by starts_on desc
  limit 1;

  select *
  into player_row
  from public.sport_players
  where licence_number = canonical_licence;

  select *
  into member_row
  from public.club_members as member
  where member.club_id = current_club
    and (
      (player_row.id is not null and member.sport_player_id = player_row.id)
      or regexp_replace(
        coalesce(member.licence_number_normalized, member.licence_number, ''),
        '[^0-9]+',
        '',
        'g'
      ) = canonical_licence
    )
  order by member.is_active desc, member.updated_at desc
  limit 1;

  if player_row.id is null and member_row.sport_player_id is not null then
    select *
    into player_row
    from public.sport_players
    where id = member_row.sport_player_id;
  end if;

  if member_row.id is not null and season_row.id is not null then
    select coalesce(member_season.is_licensed, false)
    into licensed_this_season
    from public.club_member_seasons as member_season
    where member_season.club_member_id = member_row.id
      and member_season.club_season_id = season_row.id;

    licensed_this_season := coalesce(licensed_this_season, false);
  end if;

  if player_row.id is not null then
    select *
    into affiliation_row
    from public.sport_player_club_affiliations as affiliation
    where affiliation.sport_player_id = player_row.id
      and affiliation.club_id = current_club
      and affiliation.is_active
      and affiliation.ends_on is null
    order by affiliation.updated_at desc
    limit 1;

    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'clubId', affiliation.club_id,
          'clubName', club.name,
          'affiliationType', affiliation.affiliation_type
        )
        order by club.name
      ),
      '[]'::jsonb
    )
    into other_affiliations
    from public.sport_player_club_affiliations as affiliation
    join public.clubs as club on club.id = affiliation.club_id
    where affiliation.sport_player_id = player_row.id
      and affiliation.club_id <> current_club
      and affiliation.is_active
      and affiliation.ends_on is null;
  end if;

  select profile.id
  into linked_profile_id
  from public.profiles as profile
  where profile.id <> target_profile_id
    and (
      (member_row.id is not null and profile.member_id = member_row.id)
      or (
        player_row.id is not null
        and profile.sport_player_id = player_row.id
      )
    )
  limit 1;

  return jsonb_build_object(
    'licenceNumber', canonical_licence,
    'foundGlobally', player_row.id is not null,
    'foundInClub', member_row.id is not null,
    'sportPlayerId', player_row.id,
    'memberId', member_row.id,
    'firstName', coalesce(
      nullif(btrim(member_row.first_name), ''),
      nullif(btrim(player_row.first_name), ''),
      nullif(btrim(profile_row.first_name), '')
    ),
    'lastName', coalesce(
      nullif(btrim(member_row.last_name), ''),
      nullif(btrim(player_row.last_name), ''),
      nullif(btrim(profile_row.last_name), '')
    ),
    'birthDate', coalesce(member_row.birth_date, player_row.birth_date),
    'gender', coalesce(member_row.gender, player_row.gender),
    'memberActive', coalesce(member_row.is_active, false),
    'licensedThisSeason', licensed_this_season,
    'affiliationType', affiliation_row.affiliation_type,
    'otherAffiliations', other_affiliations,
    'linkedToAnotherAccount', linked_profile_id is not null,
    'requiresIdentityDetails',
      member_row.id is null
      and (
        coalesce(
          nullif(btrim(player_row.first_name), ''),
          nullif(btrim(profile_row.first_name), '')
        ) is null
        or coalesce(
          nullif(btrim(player_row.last_name), ''),
          nullif(btrim(profile_row.last_name), '')
        ) is null
        or player_row.birth_date is null
        or player_row.gender is null
        or player_row.gender not in ('male', 'female')
      )
  );
end;
$$;

revoke all on function public.admin_preview_profile_licence_link(uuid, text)
  from public, anon, authenticated;
grant execute on function public.admin_preview_profile_licence_link(uuid, text)
  to authenticated;

create or replace function public.admin_link_unlicensed_profile(
  payload jsonb default '{}'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  current_club uuid := public.admin_current_club_id();
  profile_id_value uuid;
  canonical_licence text;
  affiliation_kind text;
  first_name_value text;
  last_name_value text;
  birth_date_value date;
  gender_value text;
  created_member boolean := false;
  profile_row public.profiles%rowtype;
  player_row public.sport_players%rowtype;
  member_row public.club_members%rowtype;
  existing_member_row public.club_members%rowtype;
  season_row public.club_seasons%rowtype;
  conflicting_profile_id uuid;
  reason_value text;
begin
  if actor_id is null
    or current_club is null
    or not public.has_club_permission(current_club, 'members.manage')
  then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  profile_id_value := nullif(payload->>'profileId', '')::uuid;
  affiliation_kind := nullif(payload->>'affiliationType', '');

  if profile_id_value is null then
    raise exception 'Compte PILOTOKI obligatoire' using errcode = '22023';
  end if;

  if affiliation_kind not in ('primary', 'extension') then
    raise exception 'Type d’affiliation invalide' using errcode = '22023';
  end if;

  canonical_licence := regexp_replace(
    coalesce(payload->>'licenceNumber', ''),
    '[^0-9]+',
    '',
    'g'
  );

  if canonical_licence = '' or length(canonical_licence) > 6 then
    raise exception 'Numéro de licence invalide' using errcode = '22023';
  end if;

  canonical_licence := lpad(canonical_licence, 6, '0');

  select *
  into profile_row
  from public.profiles
  where id = profile_id_value
  for update;

  if profile_row.id is null then
    raise exception 'Compte PILOTOKI introuvable' using errcode = 'P0002';
  end if;

  select *
  into existing_member_row
  from public.club_members
  where id = public.profile_club_member_id(profile_id_value, current_club);

  select *
  into season_row
  from public.club_seasons
  where club_id = current_club
    and is_active
  order by starts_on desc
  limit 1
  for share;

  if season_row.id is null then
    raise exception 'Aucune saison active' using errcode = '22023';
  end if;

  select *
  into player_row
  from public.sport_players
  where licence_number = canonical_licence
  for update;

  select *
  into member_row
  from public.club_members as member
  where member.club_id = current_club
    and (
      (player_row.id is not null and member.sport_player_id = player_row.id)
      or regexp_replace(
        coalesce(member.licence_number_normalized, member.licence_number, ''),
        '[^0-9]+',
        '',
        'g'
      ) = canonical_licence
    )
  order by member.is_active desc, member.updated_at desc
  limit 1
  for update;

  if existing_member_row.id is not null
    and (
      member_row.id is null
      or existing_member_row.id <> member_row.id
    )
  then
    raise exception 'Ce compte est déjà rattaché à une autre fiche licencié'
      using errcode = '23505';
  end if;

  if player_row.id is not null then
    select profile.id
    into conflicting_profile_id
    from public.profiles as profile
    where profile.id <> profile_id_value
      and (
        profile.sport_player_id = player_row.id
        or (member_row.id is not null and profile.member_id = member_row.id)
      )
    limit 1;

    if conflicting_profile_id is not null then
      raise exception 'Cette licence est déjà rattachée à un autre compte'
        using errcode = '23505';
    end if;

    if affiliation_kind = 'primary' and exists (
      select 1
      from public.sport_player_club_affiliations as affiliation
      where affiliation.sport_player_id = player_row.id
        and affiliation.club_id <> current_club
        and affiliation.affiliation_type = 'primary'
        and affiliation.is_active
        and affiliation.ends_on is null
    ) then
      raise exception 'Cette licence possède déjà un club principal : utilisez Extension'
        using errcode = '23505';
    end if;
  end if;

  if member_row.id is null then
    first_name_value := coalesce(
      nullif(btrim(payload->>'firstName'), ''),
      nullif(btrim(player_row.first_name), ''),
      nullif(btrim(profile_row.first_name), '')
    );
    last_name_value := coalesce(
      nullif(btrim(payload->>'lastName'), ''),
      nullif(btrim(player_row.last_name), ''),
      nullif(btrim(profile_row.last_name), '')
    );
    birth_date_value := coalesce(
      nullif(payload->>'birthDate', '')::date,
      player_row.birth_date
    );
    gender_value := coalesce(
      nullif(payload->>'gender', ''),
      player_row.gender
    );

    if first_name_value is null
      or last_name_value is null
      or birth_date_value is null
      or gender_value is null
      or gender_value not in ('male', 'female')
    then
      raise exception
        'Nom, prénom, date de naissance et sexe sont obligatoires pour créer la fiche au club'
        using errcode = '22023';
    end if;

    insert into public.club_members (
      club_id,
      licence_number,
      first_name,
      last_name,
      birth_date,
      email,
      gender,
      is_active
    ) values (
      current_club,
      canonical_licence,
      first_name_value,
      last_name_value,
      birth_date_value,
      profile_row.email,
      gender_value,
      true
    )
    returning * into member_row;

    created_member := true;

    select *
    into member_row
    from public.club_members
    where id = member_row.id
    for update;
  elsif not member_row.is_active then
    update public.club_members
    set is_active = true,
        updated_at = now()
    where id = member_row.id
    returning * into member_row;
  end if;

  if member_row.sport_player_id is null then
    raise exception 'Impossible de créer l’identité sportive globale'
      using errcode = 'P0001';
  end if;

  select profile.id
  into conflicting_profile_id
  from public.profiles as profile
  where profile.id <> profile_id_value
    and (
      profile.member_id = member_row.id
      or profile.sport_player_id = member_row.sport_player_id
    )
  limit 1;

  if conflicting_profile_id is not null then
    raise exception 'Cette licence est déjà rattachée à un autre compte'
      using errcode = '23505';
  end if;

  insert into public.club_member_seasons (
    club_member_id,
    club_id,
    club_season_id,
    ranking,
    category,
    is_licensed,
    created_by,
    updated_by
  ) values (
    member_row.id,
    current_club,
    season_row.id,
    null,
    public.member_category(member_row.birth_date, season_row.ends_on),
    true,
    actor_id,
    actor_id
  )
  on conflict (club_member_id, club_season_id) do update
  set club_id = excluded.club_id,
      category = excluded.category,
      is_licensed = true,
      updated_at = now(),
      updated_by = actor_id;

  update public.sport_player_club_affiliations
  set affiliation_type = affiliation_kind,
      is_active = true,
      starts_on = coalesce(starts_on, season_row.starts_on),
      ends_on = null,
      source = 'admin_profile_link',
      updated_at = now()
  where source_member_id = member_row.id;

  if not found then
    update public.sport_player_club_affiliations
    set source_member_id = member_row.id,
        affiliation_type = affiliation_kind,
        is_active = true,
        starts_on = coalesce(starts_on, season_row.starts_on),
        ends_on = null,
        source = 'admin_profile_link',
        updated_at = now()
    where sport_player_id = member_row.sport_player_id
      and club_id = current_club
      and is_active
      and ends_on is null;
  end if;

  if not found then
    insert into public.sport_player_club_affiliations (
      sport_player_id,
      club_id,
      affiliation_type,
      is_active,
      starts_on,
      source,
      source_member_id
    ) values (
      member_row.sport_player_id,
      current_club,
      affiliation_kind,
      true,
      season_row.starts_on,
      'admin_profile_link',
      member_row.id
    );
  end if;

  perform set_config('app.allow_profile_member_link', 'on', true);
  perform set_config('app.allow_profile_sport_player_link', 'on', true);

  update public.profiles
  set member_id = coalesce(member_id, member_row.id),
      sport_player_id = member_row.sport_player_id,
      updated_at = now()
  where id = profile_id_value
    and (
      sport_player_id is null
      or sport_player_id = member_row.sport_player_id
    )
    and (
      member_id is null
      or exists (
        select 1
        from public.club_members as linked_member
        where linked_member.id = public.profiles.member_id
          and linked_member.sport_player_id = member_row.sport_player_id
      )
    );

  if not found then
    raise exception 'Ce compte est déjà rattaché à une autre licence'
      using errcode = '23505';
  end if;

  reason_value := coalesce(
    nullif(btrim(payload->>'reason'), ''),
    'Rattachement manuel d’un compte PILOTOKI sans licence'
  );

  insert into public.club_member_audit_log (
    club_member_id,
    club_id,
    club_season_id,
    author_id,
    action,
    after_values,
    reason,
    metadata
  ) values (
    member_row.id,
    current_club,
    season_row.id,
    actor_id,
    'admin_account_linked',
    jsonb_build_object(
      'profileId', profile_id_value,
      'licenceNumber', canonical_licence,
      'affiliationType', affiliation_kind,
      'createdMember', created_member
    ),
    reason_value,
    jsonb_build_object(
      'source', 'admin_unlicensed_pilotoki_users'
    )
  );

  return jsonb_build_object(
    'profileId', profile_id_value,
    'memberId', member_row.id,
    'sportPlayerId', member_row.sport_player_id,
    'licenceNumber', canonical_licence,
    'affiliationType', affiliation_kind,
    'createdMember', created_member
  );
end;
$$;

revoke all on function public.admin_link_unlicensed_profile(jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_link_unlicensed_profile(jsonb)
  to authenticated;

create or replace function public.list_my_licence_clubs()
returns table (
  club_id uuid,
  club_name text,
  member_id uuid,
  is_default boolean,
  campaign_id uuid,
  season_name text,
  campaign_is_open boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    club.id,
    club.name,
    public.profile_club_member_id(auth.uid(), club.id) as member_id,
    exists (
      select 1
      from public.profiles as profile
      join public.sport_player_club_affiliations as affiliation
        on affiliation.sport_player_id = profile.sport_player_id
       and affiliation.club_id = club.id
       and affiliation.affiliation_type = 'primary'
       and affiliation.is_active
       and (
         affiliation.ends_on is null
         or affiliation.ends_on >= current_date
       )
      where profile.id = auth.uid()
    ) as is_default,
    campaign.id,
    season.name,
    (
      campaign.is_open
      and (campaign.opens_at is null or campaign.opens_at <= now())
      and (campaign.closes_at is null or campaign.closes_at >= now())
    ) as campaign_is_open
  from public.clubs as club
  join lateral (
    select licence_campaign.*
    from public.licence_campaigns as licence_campaign
    join public.club_seasons as club_season
      on club_season.id = licence_campaign.club_season_id
    where licence_campaign.club_id = club.id
    order by
      case
        when licence_campaign.is_open
          and (licence_campaign.opens_at is null or licence_campaign.opens_at <= now())
          and (licence_campaign.closes_at is null or licence_campaign.closes_at >= now())
        then 0 else 1
      end,
      club_season.starts_on desc,
      licence_campaign.created_at desc
    limit 1
  ) as campaign on true
  join public.club_seasons as season
    on season.id = campaign.club_season_id
  order by
    is_default desc,
    (public.profile_club_member_id(auth.uid(), club.id) is not null) desc,
    club.name,
    club.id;
$$;

revoke all on function public.list_my_licence_clubs()
  from public, anon, authenticated;
grant execute on function public.list_my_licence_clubs()
  to authenticated;

create or replace function public.get_licence_payment_mode(
  target_payment_id uuid default null::uuid
)
returns text
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_club_id uuid;
  mode_value text;
begin
  if actor_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  if target_payment_id is not null then
    select campaign.payment_mode
    into mode_value
    from public.payments as payment
    join public.licence_requests as request
      on request.id = payment.licence_request_id
    join public.licence_campaigns as campaign
      on campaign.id = request.campaign_id
    where payment.id = target_payment_id
      and payment.payment_context = 'licence'
      and request.profile_id = actor_id
    limit 1;

    if mode_value is null then
      raise exception 'Paiement de licence introuvable' using errcode = 'P0002';
    end if;

    return mode_value;
  end if;

  select licence_club.club_id
  into target_club_id
  from public.list_my_licence_clubs() as licence_club
  order by
    licence_club.is_default desc,
    (licence_club.member_id is not null) desc,
    licence_club.club_name,
    licence_club.club_id
  limit 1;

  if target_club_id is null then
    return 'test';
  end if;

  select campaign.payment_mode
  into mode_value
  from public.licence_campaigns as campaign
  join public.club_seasons as season
    on season.id = campaign.club_season_id
  where campaign.club_id = target_club_id
  order by
    case
      when campaign.is_open
        and (campaign.opens_at is null or campaign.opens_at <= now())
        and (campaign.closes_at is null or campaign.closes_at >= now())
      then 0
      else 1
    end,
    season.starts_on desc,
    campaign.created_at desc
  limit 1;

  return coalesce(mode_value, 'test');
end;
$$;

revoke all on function public.get_licence_payment_mode(uuid)
  from public, anon;
grant execute on function public.get_licence_payment_mode(uuid)
  to authenticated;

commit;
