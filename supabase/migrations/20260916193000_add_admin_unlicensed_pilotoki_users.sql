begin;

create or replace function public.admin_list_unlicensed_pilotoki_users(
  filters jsonb default '{}'::jsonb
)
returns table (
  id uuid,
  email text,
  first_name text,
  last_name text,
  display_name text,
  created_at timestamptz,
  member_id uuid,
  licence_number text,
  status text,
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
    or not public.has_club_permission(current_club, 'members.manage') then
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
      profile.id,
      profile.email,
      profile.first_name,
      profile.last_name,
      profile.display_name,
      profile.created_at,
      member.id as member_id,
      member.licence_number,
      case
        when member.id is null then 'unlinked'
        when not member.is_active then 'member_inactive'
        else 'unlicensed'
      end as status
    from public.profiles as profile
    left join public.club_members as member
      on member.id = profile.member_id
     and member.club_id = current_club
    left join active_season as season on true
    left join public.club_member_seasons as member_season
      on member_season.club_member_id = member.id
     and member_season.club_season_id = season.id
    where
      (profile.member_id is null or member.id is not null)
      and (
        (member.id is not null and not member.is_active)
        or not coalesce(member_season.is_licensed, false)
      )
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
    filtered.id,
    filtered.email,
    filtered.first_name,
    filtered.last_name,
    filtered.display_name,
    filtered.created_at,
    filtered.member_id,
    filtered.licence_number,
    filtered.status,
    count(*) over() as total_count
  from filtered
  order by
    filtered.created_at desc,
    lower(coalesce(filtered.last_name, filtered.display_name, filtered.email, '')),
    filtered.id
  limit page_size
  offset (page_number - 1) * page_size;
end;
$$;

revoke all on function public.admin_list_unlicensed_pilotoki_users(jsonb)
from public, anon, authenticated;
grant execute on function public.admin_list_unlicensed_pilotoki_users(jsonb)
to authenticated;

comment on function public.admin_list_unlicensed_pilotoki_users(jsonb) is
  'Liste paginée des comptes PILOTOKI de l instance club sans licence valide sur la saison active. Accès members.manage uniquement.';

commit;
