begin;

create or replace function public.list_my_member_clubs()
returns table (
  club_id uuid,
  club_name text,
  member_id uuid,
  licence_number text,
  first_name text,
  last_name text,
  is_active boolean,
  season text,
  is_licensed boolean,
  affiliation_type text,
  is_default boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  with actor as (
    select profile.id, profile.member_id, profile.sport_player_id
    from public.profiles as profile
    where profile.id = auth.uid()
  ),
  local_members as (
    select
      member.*,
      actor.member_id as legacy_member_id,
      row_number() over (
        partition by member.club_id
        order by
          case when member.id = actor.member_id then 0 else 1 end,
          member.is_active desc,
          member.updated_at desc,
          member.id
      ) as member_rank
    from actor
    join public.club_members as member
      on (
        actor.sport_player_id is not null
        and member.sport_player_id = actor.sport_player_id
      )
      or (
        actor.sport_player_id is null
        and member.id = actor.member_id
      )
  )
  select
    club.id,
    club.name,
    member.id,
    member.licence_number,
    member.first_name,
    member.last_name,
    member.is_active,
    season.name,
    coalesce(member_season.is_licensed, false),
    affiliation.affiliation_type,
    (
      member.id = member.legacy_member_id
      or affiliation.affiliation_type = 'primary'
    )
  from local_members as member
  join public.clubs as club on club.id = member.club_id
  left join lateral (
    select club_season.*
    from public.club_seasons as club_season
    where club_season.club_id = member.club_id
      and club_season.is_active
    order by club_season.starts_on desc, club_season.id
    limit 1
  ) as season on true
  left join public.club_member_seasons as member_season
    on member_season.club_member_id = member.id
   and member_season.club_season_id = season.id
  left join lateral (
    select player_affiliation.affiliation_type
    from public.sport_player_club_affiliations as player_affiliation
    where player_affiliation.sport_player_id = member.sport_player_id
      and player_affiliation.club_id = member.club_id
      and player_affiliation.is_active
      and (
        player_affiliation.ends_on is null
        or player_affiliation.ends_on >= current_date
      )
    order by
      case player_affiliation.affiliation_type
        when 'primary' then 0
        when 'extension' then 1
        else 2
      end,
      player_affiliation.updated_at desc,
      player_affiliation.id
    limit 1
  ) as affiliation on true
  where member.member_rank = 1
  order by
    case
      when member.id = member.legacy_member_id then 0
      when affiliation.affiliation_type = 'primary' then 1
      else 2
    end,
    club.name,
    club.id;
$$;

revoke all on function public.list_my_member_clubs()
  from public, anon, authenticated;
grant execute on function public.list_my_member_clubs()
  to authenticated;

create or replace function public.get_my_member_profile()
returns table (
  licence_number text,
  first_name text,
  last_name text,
  is_active boolean,
  season text,
  is_licensed boolean
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    member_club.licence_number,
    member_club.first_name,
    member_club.last_name,
    member_club.is_active,
    member_club.season,
    member_club.is_licensed
  from public.list_my_member_clubs() as member_club
  order by
    member_club.is_default desc,
    case member_club.affiliation_type
      when 'primary' then 0
      when 'extension' then 1
      else 2
    end,
    member_club.club_name,
    member_club.club_id
  limit 1;
$$;

revoke all on function public.get_my_member_profile() from public, anon;
grant execute on function public.get_my_member_profile() to authenticated;

commit;
