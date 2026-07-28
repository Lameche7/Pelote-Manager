create type public.user_role as enum ('visitor', 'user', 'member', 'admin');

alter table public.profiles
add column role public.user_role not null default 'visitor';

create function public.protect_profile_role()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) = 'authenticated' then
    if tg_op = 'INSERT' and new.role <> 'visitor'::public.user_role then
      raise exception 'Users cannot assign their own profile role'
        using errcode = '42501';
    end if;

    if tg_op = 'UPDATE' and new.role is distinct from old.role then
      raise exception 'Users cannot change their own profile role'
        using errcode = '42501';
    end if;
  end if;

  return new;
end;
$$;

create trigger protect_profile_role
before insert or update on public.profiles
for each row execute function public.protect_profile_role();
