-- Read-only projection for the authenticated user's linked member profile.
-- PR38 moved seasonal licence data out of club_members into club_member_seasons,
-- while club_seasons itself remains administration-only under RLS. Expose only the
-- current user's own member data through a narrow SECURITY DEFINER function.
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
    member.licence_number,
    member.first_name,
    member.last_name,
    member.is_active,
    season.name,
    coalesce(member_season.is_licensed, false)
  from public.profiles as profile
  join public.club_members as member
    on member.id = profile.member_id
  left join public.club_seasons as season
    on season.club_id = member.club_id
   and season.is_active
  left join public.club_member_seasons as member_season
    on member_season.club_member_id = member.id
   and member_season.club_season_id = season.id
  where profile.id = auth.uid();
$$;

revoke all on function public.get_my_member_profile() from public;
grant execute on function public.get_my_member_profile() to authenticated;
