begin;

do $migration$
declare
  function_definition text;
  patched_definition text;
  old_fragment text := $old$
  if target_profile.id is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;
$old$;
  new_fragment text := $new$
  if target_profile.id is null then
    raise exception 'Profile not found' using errcode = 'P0002';
  end if;

  if target_profile.member_id is not null and not exists (
    select 1
    from public.club_members as member
    where member.id = target_profile.member_id
      and member.is_active
  ) then
    raise exception 'Profile is linked to an inactive member'
      using errcode = '23514';
  end if;
$new$;
begin
  function_definition := replace(
    pg_get_functiondef(
      'public.admin_link_tournament_account(uuid,uuid)'::regprocedure
    ),
    chr(13),
    ''
  );

  if position(old_fragment in function_definition) = 0 then
    raise exception 'admin_link_tournament_account changed unexpectedly';
  end if;

  patched_definition := replace(function_definition, old_fragment, new_fragment);
  execute patched_definition;
end;
$migration$;

commit;
