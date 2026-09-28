begin;

-- PILOTOKI Network - profile/global player compatibility repair.
-- profiles.member_id remains untouched and continues to support legacy PCL flows.

do $$
begin
  if exists (
    select 1
    from public.profiles as profile
    join public.club_members as member on member.id = profile.member_id
    where profile.sport_player_id is not null
      and member.sport_player_id is not null
      and profile.sport_player_id <> member.sport_player_id
  ) then
    raise exception 'A profile is linked to a different global player than its legacy member';
  end if;
end;
$$;

-- The global link already has a protection trigger. Lift it only for this
-- controlled compatibility backfill.
select set_config('app.allow_profile_sport_player_link', 'on', true);

update public.profiles as profile
set sport_player_id = member.sport_player_id,
    updated_at = now()
from public.club_members as member
where profile.member_id = member.id
  and member.sport_player_id is not null
  and profile.sport_player_id is null;

do $$
begin
  if exists (
    select 1
    from public.profiles as profile
    join public.club_members as member on member.id = profile.member_id
    where member.sport_player_id is not null
      and profile.sport_player_id is distinct from member.sport_player_id
  ) then
    raise exception 'Profile compatibility backfill incomplete';
  end if;
end;
$$;

comment on column public.profiles.sport_player_id is
  'Global sports identity for the account. profiles.member_id remains the legacy PCL compatibility link until all consumers are migrated.';

commit;
