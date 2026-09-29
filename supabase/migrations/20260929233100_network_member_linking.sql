begin;

create or replace function public.link_profile_to_member(
  licence_number text,
  last_name text,
  first_name text,
  birth_date date
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  current_profile_id uuid := auth.uid();
  current_profile public.profiles%rowtype;
  target_player_id uuid;
  target_member_id uuid;
  linked_profile_id uuid;
begin
  if current_profile_id is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if nullif(btrim(link_profile_to_member.licence_number), '') is null
    or nullif(btrim(link_profile_to_member.last_name), '') is null
    or nullif(btrim(link_profile_to_member.first_name), '') is null
    or link_profile_to_member.birth_date is null
  then
    raise exception 'Complete member identity is required'
      using errcode = '22023';
  end if;

  select *
  into current_profile
  from public.profiles
  where id = current_profile_id
  for update;

  if current_profile.id is null then
    raise exception 'Current profile not found'
      using errcode = 'P0002';
  end if;

  select player.id
  into target_player_id
  from public.sport_players as player
  where public.normalize_member_licence(player.licence_number) =
        public.normalize_member_licence(link_profile_to_member.licence_number)
    and public.normalize_member_identity(player.last_name) =
        public.normalize_member_identity(link_profile_to_member.last_name)
    and public.normalize_member_identity(player.first_name) =
        public.normalize_member_identity(link_profile_to_member.first_name)
    and player.birth_date = link_profile_to_member.birth_date
  limit 1;

  if target_player_id is null then
    raise exception 'Member identity does not match the club licence registry'
      using errcode = 'P0002';
  end if;

  select member.id
  into target_member_id
  from public.club_members as member
  left join lateral (
    select affiliation.affiliation_type
    from public.sport_player_club_affiliations as affiliation
    where affiliation.sport_player_id = member.sport_player_id
      and affiliation.club_id = member.club_id
      and affiliation.is_active
      and (
        affiliation.ends_on is null
        or affiliation.ends_on >= current_date
      )
    order by
      case affiliation.affiliation_type
        when 'primary' then 0
        when 'extension' then 1
        else 2
      end,
      affiliation.updated_at desc,
      affiliation.id
    limit 1
  ) as affiliation on true
  where member.sport_player_id = target_player_id
    and member.licence_number_normalized =
        public.normalize_member_licence(link_profile_to_member.licence_number)
    and member.last_name_normalized =
        public.normalize_member_identity(link_profile_to_member.last_name)
    and member.first_name_normalized =
        public.normalize_member_identity(link_profile_to_member.first_name)
    and member.birth_date = link_profile_to_member.birth_date
  order by
    case when member.id = current_profile.member_id then 0 else 1 end,
    case affiliation.affiliation_type
      when 'primary' then 0
      when 'extension' then 1
      else 2
    end,
    member.is_active desc,
    member.updated_at desc,
    member.id
  limit 1;

  if target_member_id is null then
    raise exception 'Member identity does not match the club licence registry'
      using errcode = 'P0002';
  end if;

  if current_profile.sport_player_id is not null
    and current_profile.sport_player_id <> target_player_id
  then
    raise exception 'This account is already linked to another licence'
      using errcode = '23505';
  end if;

  if current_profile.member_id is not null
    and not exists (
      select 1
      from public.club_members as current_member
      where current_member.id = current_profile.member_id
        and current_member.sport_player_id = target_player_id
    )
  then
    raise exception 'This account is already linked to another licence'
      using errcode = '23505';
  end if;

  select profile.id
  into linked_profile_id
  from public.profiles as profile
  where profile.id <> current_profile_id
    and (
      profile.sport_player_id = target_player_id
      or profile.member_id in (
        select member.id
        from public.club_members as member
        where member.sport_player_id = target_player_id
      )
    )
  limit 1;

  if linked_profile_id is not null then
    raise exception 'Licence is already linked to another account'
      using errcode = '23505';
  end if;

  perform set_config('app.allow_profile_member_link', 'on', true);
  perform set_config('app.allow_profile_sport_player_link', 'on', true);

  update public.profiles
  set member_id = target_member_id,
      sport_player_id = target_player_id,
      updated_at = now()
  where id = current_profile_id;

  return target_member_id;
end;
$$;

revoke all on function public.link_profile_to_member(text, text, text, date)
  from public, anon;
grant execute on function public.link_profile_to_member(text, text, text, date)
  to authenticated;

commit;
