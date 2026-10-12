begin;

-- First Pilotoki Network tenant: additive bootstrap, no mutation of Lourdes data.
do $$
declare
  test_club_id uuid;
  test_profile_id uuid;
  administrator_role_id uuid;
  role_entry record;
  profile_count integer;
begin
  select id into test_club_id from public.clubs where slug = 'club-test-pilotoki';
  if test_club_id is null then
    insert into public.clubs(name,slug,email,notes)
    values ('Club Test Pilotoki','club-test-pilotoki','usadepetanque65@gmail.com',
      'Club de validation interne Pilotoki Network — aucune donnée du club de Lourdes.')
    returning id into test_club_id;
  elsif not exists (
    select 1 from public.clubs
    where id=test_club_id and name='Club Test Pilotoki'
  ) then
    raise exception 'The test club slug is already used by another club';
  end if;

  -- Each club has its own role IDs; never reuse Lourdes' roles.
  for role_entry in
    select * from (values
      ('administrator'::public.club_role_key, 'Administrateur'),
      ('reservation_manager'::public.club_role_key, 'Responsable Réservations'),
      ('tournament_manager'::public.club_role_key, 'Responsable Tournois'),
      ('communication_manager'::public.club_role_key, 'Responsable Communication'),
      ('treasurer'::public.club_role_key, 'Trésorier')
    ) as roles(role_key, role_name)
  loop
    insert into public.club_roles(club_id,key,name)
    values(test_club_id,role_entry.role_key,role_entry.role_name)
    on conflict(club_id,key) do nothing;
  end loop;

  insert into public.club_role_permissions(role_id,permission_key)
  select role.id, permission.key
  from public.club_roles role cross join public.permissions permission
  where role.club_id=test_club_id and role.key='administrator'
  on conflict do nothing;

  insert into public.club_role_permissions(role_id,permission_key)
  select role.id, permission.key
  from public.club_roles role join public.permissions permission on
    (role.key='reservation_manager' and permission.key in ('admin.dashboard.read','reservations.manage'))
    or (role.key='tournament_manager' and permission.key in ('admin.dashboard.read','tournaments.manage'))
    or (role.key='communication_manager' and permission.key in ('admin.dashboard.read','communication.manage'))
    or (role.key='treasurer' and permission.key in
      ('admin.dashboard.read','statistics.read','payments.read','payments.manage','pricing.manage'))
  where role.club_id=test_club_id
  on conflict do nothing;

  -- Never guess an identity: exact email, unique existing profile, no membership elsewhere.
  select count(*),min(id) into profile_count,test_profile_id
  from public.profiles
  where lower(btrim(email))='usadepetanque65@gmail.com';
  if profile_count <> 1 then
    raise exception 'Expected exactly one registered test account; found %', profile_count;
  end if;
  if exists (
    select 1 from public.club_memberships
    where profile_id=test_profile_id and club_id<>test_club_id
  ) then
    raise exception 'Test account already has membership in another club';
  end if;

  select id into administrator_role_id from public.club_roles
  where club_id=test_club_id and key='administrator';
  insert into public.club_memberships(club_id,profile_id,role_id)
  values(test_club_id,test_profile_id,administrator_role_id)
  on conflict(club_id,profile_id) do update set role_id=excluded.role_id;
end
$$;

commit;
