begin;

create or replace function public.admin_get_member(target_member_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  requester uuid := public.admin_current_club_id();
  member public.club_members%rowtype;
  result jsonb;
begin
  if not (
    public.has_club_permission(requester, 'members.manage')
    or public.has_club_permission(requester, 'tournaments.manage')
  ) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  select * into member
  from public.club_members
  where id = target_member_id;

  if member.id is null then
    raise exception 'Licencié introuvable' using errcode = 'P0002';
  end if;

  if member.club_id <> requester then
    insert into public.club_member_access_log(
      club_member_id, requesting_club_id, member_club_id, accessed_by
    )
    values(member.id, requester, member.club_id, auth.uid());
  end if;

  select
    to_jsonb(member)
    || jsonb_build_object(
      'club_name', club.name,
      'linked_account', public.club_member_profile_id(member.id) is not null,
      'canEdit', public.has_club_permission(member.club_id, 'members.manage'),
      'seasons',
        coalesce((
          select jsonb_agg(
            jsonb_build_object(
              'id', member_season.id,
              'clubSeasonId', season.id,
              'seasonName', season.name,
              'isActive', season.is_active,
              'clubId', member_season.club_id,
              'clubName', history_club.name,
              'ranking', member_season.ranking,
              'category', member_season.category,
              'isLicensed', member_season.is_licensed,
              'updatedAt', member_season.updated_at
            )
            order by season.ends_on desc
          )
          from public.club_member_seasons as member_season
          join public.club_seasons as season
            on season.id = member_season.club_season_id
          join public.clubs as history_club
            on history_club.id = member_season.club_id
          where member_season.club_member_id = member.id
        ), '[]'::jsonb)
    )
  into result
  from public.clubs as club
  where club.id = member.club_id;

  return result;
end;
$$;

create or replace function public.admin_list_club_members(filters jsonb default '{}'::jsonb)
returns table(
  id uuid, club_id uuid, club_name text, licence_number text, last_name text,
  first_name text, birth_date date, gender text, email text, phone text,
  is_active boolean, ranking text, category text, is_licensed boolean,
  linked_account boolean, updated_at timestamptz, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_club uuid := public.admin_current_club_id();
begin
  if not public.has_club_permission(current_club, 'members.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return query
  with active_season as (
    select season.id
    from public.club_seasons as season
    where season.club_id = current_club
      and season.is_active
  ),
  result as (
    select
      member.*,
      club.name as club_name,
      member_season.ranking,
      member_season.category,
      coalesce(member_season.is_licensed, false) as licensed,
      public.club_member_profile_id(member.id) is not null as linked
    from public.club_members as member
    join public.clubs as club on club.id = member.club_id
    left join active_season as active on true
    left join public.club_member_seasons as member_season
      on member_season.club_member_id = member.id
     and member_season.club_season_id = active.id
    where member.club_id = current_club
      and (
        coalesce(filters->>'search', '') = ''
        or member.licence_number_normalized like '%' || public.normalize_member_licence(filters->>'search') || '%'
        or member.last_name_normalized like '%' || public.normalize_member_identity(filters->>'search') || '%'
        or member.first_name_normalized like '%' || public.normalize_member_identity(filters->>'search') || '%'
      )
      and (
        coalesce(filters->>'active', 'all') = 'all'
        or member.is_active = (filters->>'active')::boolean
      )
      and (
        coalesce(filters->>'licensed', 'all') = 'all'
        or coalesce(member_season.is_licensed, false) = (filters->>'licensed')::boolean
      )
  )
  select
    result.id, result.club_id, result.club_name, result.licence_number,
    result.last_name, result.first_name, result.birth_date, result.gender,
    result.email, result.phone, result.is_active, result.ranking,
    result.category, result.licensed, result.linked, result.updated_at,
    count(*) over()
  from result
  order by
    case when filters->>'sort' = 'licence' then result.licence_number_normalized end,
    case when filters->>'sort' = 'first_name' then result.first_name_normalized end,
    result.last_name_normalized, result.first_name_normalized
  limit least(greatest(coalesce((filters->>'page_size')::int, 50), 1), 100)
  offset (greatest(coalesce((filters->>'page')::int, 1), 1) - 1)
    * least(greatest(coalesce((filters->>'page_size')::int, 50), 1), 100);
end;
$$;

create or replace function public.admin_search_members_global(filters jsonb default '{}'::jsonb)
returns table(
  id uuid, club_id uuid, club_name text, licence_number text, last_name text,
  first_name text, birth_date date, gender text, email text, phone text,
  is_active boolean, ranking text, category text, is_licensed boolean,
  linked_account boolean, updated_at timestamptz, total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  requester uuid := public.admin_current_club_id();
begin
  if not (
    public.has_club_permission(requester, 'members.manage')
    or public.has_club_permission(requester, 'tournaments.manage')
  ) then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if btrim(coalesce(filters->>'search', '')) = ''
    and btrim(coalesce(filters->>'licence', '')) = ''
    and btrim(coalesce(filters->>'last_name', '')) = ''
    and btrim(coalesce(filters->>'first_name', '')) = ''
    and filters->>'club_id' is null
  then
    raise exception 'Un critère de recherche ou un club est obligatoire'
      using errcode = '22023';
  end if;

  return query
  with selected_season as (
    select
      member.id as member_id,
      coalesce((filters->>'season_id')::uuid, active.id) as season_id
    from public.club_members as member
    left join lateral (
      select season.id
      from public.club_seasons as season
      where season.club_id = member.club_id
        and season.is_active
      limit 1
    ) as active on true
  ),
  result as (
    select
      member.*,
      club.name as club_name,
      member_season.ranking,
      member_season.category,
      coalesce(member_season.is_licensed, false) as licensed,
      public.club_member_profile_id(member.id) is not null as linked
    from public.club_members as member
    join public.clubs as club on club.id = member.club_id
    join selected_season as selected on selected.member_id = member.id
    left join public.club_member_seasons as member_season
      on member_season.club_member_id = member.id
     and member_season.club_season_id = selected.season_id
    where
      (
        coalesce(filters->>'search', '') = ''
        or member.licence_number_normalized like '%' || public.normalize_member_licence(filters->>'search') || '%'
        or member.last_name_normalized like '%' || public.normalize_member_identity(filters->>'search') || '%'
        or member.first_name_normalized like '%' || public.normalize_member_identity(filters->>'search') || '%'
      )
      and (
        coalesce(filters->>'licence', '') = ''
        or member.licence_number_normalized like '%' || public.normalize_member_licence(filters->>'licence') || '%'
      )
      and (
        coalesce(filters->>'last_name', '') = ''
        or member.last_name_normalized like '%' || public.normalize_member_identity(filters->>'last_name') || '%'
      )
      and (
        coalesce(filters->>'first_name', '') = ''
        or member.first_name_normalized like '%' || public.normalize_member_identity(filters->>'first_name') || '%'
      )
      and (filters->>'club_id' is null or member.club_id = (filters->>'club_id')::uuid)
      and (filters->>'active' is null or member.is_active = (filters->>'active')::boolean)
      and (filters->>'licensed' is null or coalesce(member_season.is_licensed, false) = (filters->>'licensed')::boolean)
      and (filters->>'ranking' is null or member_season.ranking = filters->>'ranking')
      and (filters->>'category' is null or member_season.category = filters->>'category')
  )
  select
    result.id, result.club_id, result.club_name, result.licence_number,
    result.last_name, result.first_name, null::date, result.gender,
    null::text, null::text, result.is_active, result.ranking,
    result.category, result.licensed, result.linked, result.updated_at,
    count(*) over()
  from result
  order by result.last_name_normalized, result.first_name_normalized
  limit least(greatest(coalesce((filters->>'page_size')::int, 25), 1), 50)
  offset (greatest(coalesce((filters->>'page')::int, 1), 1) - 1)
    * least(greatest(coalesce((filters->>'page_size')::int, 25), 1), 50);
end;
$$;

create or replace function public.admin_list_unlicensed_pilotoki_users(filters jsonb default '{}'::jsonb)
returns table(
  id uuid, email text, first_name text, last_name text, display_name text,
  created_at timestamptz, member_id uuid, licence_number text, status text,
  total_count bigint
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_club uuid := public.admin_current_club_id();
  search_term text := btrim(coalesce(filters->>'search', ''));
  page_number integer := greatest(coalesce(nullif(filters->>'page', '')::integer, 1), 1);
  page_size integer := least(
    greatest(coalesce(nullif(filters->>'page_size', '')::integer, 25), 1),
    100
  );
begin
  if current_club is null
    or not public.has_club_permission(current_club, 'members.manage')
  then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  return query
  with active_season as (
    select season.id
    from public.club_seasons as season
    where season.club_id = current_club
      and season.is_active
    limit 1
  ),
  candidates as (
    select
      profile.id, profile.email, profile.first_name, profile.last_name,
      profile.display_name, profile.created_at,
      member.id as member_id, member.licence_number,
      case
        when member.id is null then 'unlinked'
        when not member.is_active then 'member_inactive'
        else 'unlicensed'
      end as status
    from public.profiles as profile
    left join public.club_members as member
      on member.id = public.profile_club_member_id(profile.id, current_club)
    left join active_season as season on true
    left join public.club_member_seasons as member_season
      on member_season.club_member_id = member.id
     and member_season.club_season_id = season.id
    where member.id is null
       or not member.is_active
       or not coalesce(member_season.is_licensed, false)
  ),
  filtered as (
    select candidate.*
    from candidates as candidate
    where search_term = ''
      or coalesce(candidate.first_name, '') ilike '%' || search_term || '%'
      or coalesce(candidate.last_name, '') ilike '%' || search_term || '%'
      or coalesce(candidate.display_name, '') ilike '%' || search_term || '%'
      or coalesce(candidate.email, '') ilike '%' || search_term || '%'
      or coalesce(candidate.licence_number, '') ilike '%' || search_term || '%'
  )
  select
    filtered.id, filtered.email, filtered.first_name, filtered.last_name,
    filtered.display_name, filtered.created_at, filtered.member_id,
    filtered.licence_number, filtered.status, count(*) over()
  from filtered
  order by
    filtered.created_at desc,
    lower(coalesce(filtered.last_name, filtered.display_name, filtered.email, '')),
    filtered.id
  limit page_size
  offset (page_number - 1) * page_size;
end;
$$;

create or replace function public.admin_manage_reservations(
  search_text text default null,
  resource_filter uuid default null,
  status_filter public.reservation_status default null,
  customer_filter public.reservation_customer_type default null,
  range_start timestamptz default null,
  range_end timestamptz default null
)
returns table(
  id uuid, resource_id uuid, resource_name text, customer_name text,
  customer_email text, customer_type public.reservation_customer_type,
  status public.reservation_status, payment_status public.payment_status,
  starts_at timestamptz, ends_at timestamptz, price_cents integer,
  created_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_club uuid := public.admin_current_club_id();
begin
  if current_club is null
    or not public.has_club_permission(current_club, 'reservations.manage')
  then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  return query
  select
    reservation.id, reservation.resource_id, resource.name,
    coalesce(
      nullif(btrim(concat_ws(' ', member.first_name, member.last_name)), ''),
      profile.display_name, reservation.guest_name, 'Réservation'
    ),
    coalesce(profile.email, reservation.guest_email, ''),
    reservation.customer_type, reservation.status, reservation.payment_status,
    reservation.starts_at, reservation.ends_at, reservation.price_cents,
    reservation.created_at
  from public.reservations as reservation
  join public.reservable_resources as resource
    on resource.id = reservation.resource_id
  left join public.profiles as profile
    on profile.id = reservation.user_id
  left join public.club_members as member
    on member.id = public.profile_club_member_id(profile.id, resource.club_id)
  where resource.club_id = current_club
    and (resource_filter is null or reservation.resource_id = resource_filter)
    and (status_filter is null or reservation.status = status_filter)
    and (customer_filter is null or reservation.customer_type = customer_filter)
    and (range_start is null or reservation.starts_at >= range_start)
    and (range_end is null or reservation.starts_at < range_end)
    and (
      nullif(btrim(search_text), '') is null
      or coalesce(member.first_name || ' ' || member.last_name, profile.display_name, reservation.guest_name, '')
        ilike '%' || btrim(search_text) || '%'
      or coalesce(profile.email, reservation.guest_email, '')
        ilike '%' || btrim(search_text) || '%'
    )
  order by reservation.starts_at desc;
end;
$$;

create or replace function public.admin_search_reservation_users(search_text text)
returns table(id uuid, name text, email text, license_number text)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  current_club uuid := public.admin_current_club_id();
begin
  if current_club is null
    or not public.has_club_permission(current_club, 'reservations.manage')
  then
    raise exception 'Accès administrateur requis' using errcode = '42501';
  end if;

  if length(btrim(coalesce(search_text, ''))) < 2 then
    return;
  end if;

  return query
  select distinct
    profile.id,
    coalesce(
      nullif(btrim(concat_ws(' ', member.first_name, member.last_name)), ''),
      profile.display_name, profile.email, 'Utilisateur'
    ),
    profile.email,
    coalesce(member.licence_number, '')
  from public.profiles as profile
  left join public.club_members as member
    on member.id = public.profile_club_member_id(profile.id, current_club)
  where (
      member.id is not null
      or exists (
        select 1 from public.club_memberships as membership
        where membership.profile_id = profile.id
          and membership.club_id = current_club
      )
      or exists (
        select 1
        from public.reservations as previous_reservation
        join public.reservable_resources as previous_resource
          on previous_resource.id = previous_reservation.resource_id
        where previous_reservation.user_id = profile.id
          and previous_resource.club_id = current_club
      )
    )
    and (
      profile.email ilike '%' || btrim(search_text) || '%'
      or profile.display_name ilike '%' || btrim(search_text) || '%'
      or member.first_name ilike '%' || btrim(search_text) || '%'
      or member.last_name ilike '%' || btrim(search_text) || '%'
      or member.licence_number ilike '%' || btrim(search_text) || '%'
    )
  order by 2
  limit 20;
end;
$$;

revoke all on function public.admin_get_member(uuid)
  from public, anon, authenticated;
grant execute on function public.admin_get_member(uuid) to authenticated;

revoke all on function public.admin_list_club_members(jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_list_club_members(jsonb) to authenticated;

revoke all on function public.admin_search_members_global(jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_search_members_global(jsonb) to authenticated;

revoke all on function public.admin_list_unlicensed_pilotoki_users(jsonb)
  from public, anon, authenticated;
grant execute on function public.admin_list_unlicensed_pilotoki_users(jsonb) to authenticated;

revoke all on function public.admin_manage_reservations(
  text, uuid, public.reservation_status, public.reservation_customer_type, timestamptz, timestamptz
) from public, anon, authenticated;
grant execute on function public.admin_manage_reservations(
  text, uuid, public.reservation_status, public.reservation_customer_type, timestamptz, timestamptz
) to authenticated;

revoke all on function public.admin_search_reservation_users(text)
  from public, anon, authenticated;
grant execute on function public.admin_search_reservation_users(text) to authenticated;

commit;
