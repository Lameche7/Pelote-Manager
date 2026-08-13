-- Registration verifies a club member identity before an Auth account exists.
-- PR38 accidentally required an authenticated session, making every anonymous
-- licence verification return false. Keep the normalized comparison while
-- exposing only a boolean result to anonymous visitors.
create or replace function public.find_member_by_licence(
  licence_number text,
  last_name text,
  first_name text,
  birth_date date
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.club_members as member
    where member.licence_number_normalized = public.normalize_member_licence(licence_number)
      and member.last_name_normalized = public.normalize_member_identity(last_name)
      and member.first_name_normalized = public.normalize_member_identity(first_name)
      and member.birth_date = find_member_by_licence.birth_date
  );
$$;

revoke all on function public.find_member_by_licence(text, text, text, date) from public;
grant execute on function public.find_member_by_licence(text, text, text, date) to anon, authenticated;
