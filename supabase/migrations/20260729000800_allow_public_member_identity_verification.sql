-- Identity verification is the public first step of registration. The function
-- only returns a boolean and never exposes which identity field failed.
create or replace function public.find_member_by_licence(
  licence_number text,
  last_name text,
  first_name text,
  birth_date date
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if licence_number is null or licence_number = ''
    or last_name is null or last_name = ''
    or first_name is null or first_name = ''
    or birth_date is null
  then
    raise exception 'Complete member identity is required' using errcode = '22023';
  end if;

  return exists (
    select 1
    from public.club_members as members
    where members.licence_number = find_member_by_licence.licence_number
      and members.last_name = find_member_by_licence.last_name
      and members.first_name = find_member_by_licence.first_name
      and members.birth_date = find_member_by_licence.birth_date
  );
end;
$$;

revoke all on function public.find_member_by_licence(text, text, text, date) from public;
grant execute on function public.find_member_by_licence(text, text, text, date) to anon, authenticated;
