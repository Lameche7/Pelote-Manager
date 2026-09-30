begin;

drop policy if exists club_members_manager_read on public.club_members;
create policy club_members_manager_read
on public.club_members
for select
to authenticated
using (
  public.has_club_permission(club_id, 'members.manage')
  or id = public.profile_club_member_id(auth.uid(), club_id)
);

drop policy if exists club_members_owner_read on public.club_members;
create policy club_members_owner_read
on public.club_members
for select
to authenticated
using (
  id = public.profile_club_member_id(auth.uid(), club_id)
);

drop policy if exists member_seasons_read on public.club_member_seasons;
create policy member_seasons_read
on public.club_member_seasons
for select
to authenticated
using (
  public.has_club_permission(club_id, 'members.manage')
  or club_member_id = public.profile_club_member_id(auth.uid(), club_id)
);

drop policy if exists communication_deliveries_owner_read
  on public.communication_deliveries;
create policy communication_deliveries_owner_read
on public.communication_deliveries
for select
to authenticated
using (
  profile_id_at_publication = auth.uid()
  or (
    club_member_id is not null
    and club_member_id =
      public.profile_club_member_id(auth.uid(), club_id)
  )
);

drop policy if exists communication_deliveries_owner_update
  on public.communication_deliveries;
create policy communication_deliveries_owner_update
on public.communication_deliveries
for update
to authenticated
using (
  profile_id_at_publication = auth.uid()
  or (
    club_member_id is not null
    and club_member_id =
      public.profile_club_member_id(auth.uid(), club_id)
  )
)
with check (
  profile_id_at_publication = auth.uid()
  or (
    club_member_id is not null
    and club_member_id =
      public.profile_club_member_id(auth.uid(), club_id)
  )
);

create or replace function public.get_my_licence_portal()
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_club_id uuid;
begin
  if actor_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  select licence_club.club_id
  into target_club_id
  from public.list_my_licence_clubs() as licence_club
  order by
    licence_club.is_default desc,
    (licence_club.member_id is not null) desc,
    licence_club.club_name,
    licence_club.club_id
  limit 1;

  if target_club_id is null then
    return jsonb_build_object(
      'clubId', null,
      'campaign', null,
      'request', null,
      'member', null,
      'recommendedType', 'first_application'
    );
  end if;

  return public.get_my_licence_portal_for_club(target_club_id);
end;
$$;

revoke all on function public.get_my_licence_portal()
  from public, anon, authenticated;
grant execute on function public.get_my_licence_portal()
  to authenticated;

create or replace function public.start_my_licence_request(
  payload jsonb default '{}'::jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor_id uuid := auth.uid();
  target_club_id uuid;
begin
  if actor_id is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  select licence_club.club_id
  into target_club_id
  from public.list_my_licence_clubs() as licence_club
  order by
    licence_club.is_default desc,
    (licence_club.member_id is not null) desc,
    licence_club.club_name,
    licence_club.club_id
  limit 1;

  if target_club_id is null then
    raise exception 'Aucune campagne de licence disponible'
      using errcode = 'P0002';
  end if;

  return public.start_my_licence_request_for_club(
    target_club_id,
    payload
  );
end;
$$;

revoke all on function public.start_my_licence_request(jsonb)
  from public, anon, authenticated;
grant execute on function public.start_my_licence_request(jsonb)
  to authenticated;

commit;
