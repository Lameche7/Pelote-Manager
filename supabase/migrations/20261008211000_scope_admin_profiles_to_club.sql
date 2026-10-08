begin;

-- Pilotoki Network: administration d'un club, jamais annuaire global du réseau.
create or replace function public.list_profiles_for_admin()
returns table (
  id uuid, email text, first_name text, last_name text, display_name text,
  role public.user_role, created_at timestamptz, updated_at timestamptz
)
language plpgsql stable security definer set search_path = ''
as $function$
declare actor_club_id uuid;
begin
  actor_club_id := public.admin_current_club_id();
  if actor_club_id is null or not public.has_club_permission(actor_club_id, 'settings.manage') then
    raise exception 'Club administration permission required' using errcode='42501';
  end if;
  return query
    select p.id,p.email,p.first_name,p.last_name,p.display_name,
      (case
        when exists(
          select 1 from public.club_memberships cm
          join public.club_roles cr on cr.id=cm.role_id and cr.club_id=actor_club_id
          where cm.profile_id=p.id and cm.club_id=actor_club_id
            and cr.key='administrator'::public.club_role_key
        ) then 'admin'
        when public.is_active_licensee_for_club(p.id,actor_club_id,current_date) then 'member'
        else 'visitor'
      end)::public.user_role,
      p.created_at,p.updated_at
    from public.profiles p
    where exists(
      select 1 from public.club_members m
      where m.club_id=actor_club_id and (
        (p.sport_player_id is not null and m.sport_player_id=p.sport_player_id)
        or m.id=p.member_id
      )
    )
    or exists(
      select 1 from public.club_memberships cm
      where cm.profile_id=p.id and cm.club_id=actor_club_id
    )
    order by coalesce(p.display_name,p.last_name,p.first_name,p.email),p.email;
end
$function$;

revoke all on function public.list_profiles_for_admin() from public, anon;
grant execute on function public.list_profiles_for_admin() to authenticated;

-- Interdiction valable sur toutes les voies d'écriture, pas seulement le RPC admin.
-- Verrouillage du profil pour sérialiser les nominations simultanées.
create or replace function public.enforce_single_club_administrator()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $function$
declare
  nominated_key public.club_role_key;
begin
  select cr.key into nominated_key
  from public.club_roles cr
  where cr.id = new.role_id and cr.club_id = new.club_id;
  if nominated_key is distinct from 'administrator'::public.club_role_key then
    return new;
  end if;

  perform 1 from public.profiles p where p.id = new.profile_id for update;
  if exists (
    select 1
    from public.club_memberships cm
    join public.club_roles cr on cr.id = cm.role_id and cr.club_id = cm.club_id
    where cm.profile_id = new.profile_id
      and cm.club_id <> new.club_id
      and cr.key = 'administrator'::public.club_role_key
  ) then
    raise exception 'This account already administers another club'
      using errcode = '23514';
  end if;
  return new;
end
$function$;

revoke all on function public.enforce_single_club_administrator() from public, anon, authenticated;
drop trigger if exists enforce_single_club_administrator on public.club_memberships;
create trigger enforce_single_club_administrator
before insert or update of club_id, profile_id, role_id
on public.club_memberships
for each row execute function public.enforce_single_club_administrator();

-- Compatibilité signature RPC : seuls les changements de droit administrateur sont admis.
-- N'écrit jamais dans profiles.role ; les droits sont uniquement club-scopés.
create or replace function public.set_profile_role(target_profile_id uuid,new_role public.user_role)
returns public.profiles
language plpgsql security definer set search_path=''
as $function$
declare
  actor_club_id uuid;
  administrator_role_id uuid;
  target_profile public.profiles;
begin
  actor_club_id:=public.admin_current_club_id();
  if actor_club_id is null or not public.has_club_permission(actor_club_id,'settings.manage') then
    raise exception 'Club administration permission required' using errcode='42501';
  end if;
  if target_profile_id=auth.uid() then
    raise exception 'Administrators cannot change their own role' using errcode='42501';
  end if;
  if new_role is null or new_role not in ('admin'::public.user_role,'visitor'::public.user_role) then
    raise exception 'Only club administrator permission can be changed here' using errcode='22023';
  end if;
  select p.* into target_profile from public.profiles p
  where p.id=target_profile_id and (
    exists(select 1 from public.club_members m where m.club_id=actor_club_id
      and ((p.sport_player_id is not null and m.sport_player_id=p.sport_player_id) or m.id=p.member_id))
    or exists(select 1 from public.club_memberships cm where cm.club_id=actor_club_id and cm.profile_id=p.id)
  );
  if target_profile.id is null then
    raise exception 'Profile is not associated with this club' using errcode='42501';
  end if;
  if new_role='admin'::public.user_role then
    -- Un administrateur de club ne peut administrer qu'un seul club.
    -- La super-administration réseau relève d'une autorisation distincte.
    if exists (
      select 1 from public.club_memberships other_membership
      join public.club_roles other_role on other_role.id=other_membership.role_id
      where other_membership.profile_id=target_profile_id
        and other_membership.club_id<>actor_club_id
        and other_role.key='administrator'::public.club_role_key
    ) then
      raise exception 'This account already administers another club' using errcode='42501';
    end if;
    select cr.id into administrator_role_id from public.club_roles cr
    where cr.club_id=actor_club_id and cr.key='administrator'::public.club_role_key;
    if administrator_role_id is null then raise exception 'Administrator club role not found' using errcode='P0002'; end if;
    insert into public.club_memberships(club_id,profile_id,role_id)
    values(actor_club_id,target_profile_id,administrator_role_id)
    on conflict(club_id,profile_id) do update set role_id=excluded.role_id;
  else
    delete from public.club_memberships cm using public.club_roles cr
    where cm.club_id=actor_club_id and cm.profile_id=target_profile_id
      and cm.role_id=cr.id and cr.club_id=actor_club_id
      and cr.key='administrator'::public.club_role_key;
  end if;
  return target_profile;
end
$function$;

revoke all on function public.set_profile_role(uuid, public.user_role) from public, anon;
grant execute on function public.set_profile_role(uuid, public.user_role) to authenticated;
commit;
