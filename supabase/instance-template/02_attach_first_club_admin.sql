-- À exécuter après avoir créé le premier utilisateur dans Authentication > Users.
-- Remplacer uniquement l'adresse ci-dessous, puis lancer le script dans SQL Editor.

begin;

do $$
declare
  target_admin_email constant text := 'admin-a-remplacer@example.fr';
  target_profile_id uuid;
  target_club_id uuid;
  target_role_id uuid;
  target_user auth.users%rowtype;
begin
  if target_admin_email = 'admin-a-remplacer@example.fr' then
    raise exception 'Renseignez l’adresse du premier administrateur';
  end if;

  select *
  into target_user
  from auth.users
  where lower(email) = lower(target_admin_email);

  if target_user.id is null then
    raise exception 'Utilisateur introuvable dans Authentication > Users';
  end if;

  if (select count(*) from public.clubs) <> 1 then
    raise exception 'L’instance doit contenir exactement un club';
  end if;

  select id into strict target_club_id from public.clubs;

  select id
  into strict target_role_id
  from public.club_roles
  where club_id = target_club_id
    and key = 'administrator';

  target_profile_id := target_user.id;

  insert into public.profiles (
    id,
    email,
    first_name,
    last_name,
    display_name,
    role
  ) values (
    target_profile_id,
    target_user.email,
    nullif(target_user.raw_user_meta_data ->> 'first_name', ''),
    nullif(target_user.raw_user_meta_data ->> 'last_name', ''),
    coalesce(
      nullif(target_user.raw_user_meta_data ->> 'display_name', ''),
      target_user.email
    ),
    'admin'
  )
  on conflict (id) do update
  set email = excluded.email,
      role = 'admin',
      updated_at = now();

  insert into public.club_memberships (
    club_id,
    profile_id,
    role_id
  ) values (
    target_club_id,
    target_profile_id,
    target_role_id
  )
  on conflict (club_id, profile_id) do update
  set role_id = excluded.role_id;
end;
$$;

commit;
