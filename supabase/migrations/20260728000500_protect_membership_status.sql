create function public.protect_profile_membership()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if (select auth.role()) = 'authenticated'
    and not public.is_profile_admin()
    and (
      (
        tg_op = 'INSERT'
        and (
          new.membership_status <> 'pending'::public.membership_status
          or new.membership_valid_until is not null
          or new.membership_validated_at is not null
          or new.membership_validated_by is not null
        )
      )
      or (
        tg_op = 'UPDATE'
        and (
          new.membership_status is distinct from old.membership_status
          or new.membership_valid_until is distinct from old.membership_valid_until
          or new.membership_validated_at is distinct from old.membership_validated_at
          or new.membership_validated_by is distinct from old.membership_validated_by
        )
      )
    ) then
    raise exception 'Seul un administrateur peut modifier le statut de licence'
      using errcode = '42501';
  end if;

  return new;
end;
$$;

create trigger protect_profile_membership
before insert or update of
  membership_status,
  membership_valid_until,
  membership_validated_at,
  membership_validated_by
on public.profiles
for each row execute function public.protect_profile_membership();

revoke all on function public.protect_profile_membership() from public;
