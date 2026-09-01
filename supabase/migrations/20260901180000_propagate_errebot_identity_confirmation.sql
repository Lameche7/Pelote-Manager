begin;

-- PR125 — Une identité Errebot peut être confirmée après l'import du tournoi.
-- La confirmation doit alors corriger immédiatement les joueurs natifs déjà
-- créés, sans modifier la structure sportive, le planning ou les résultats.

create or replace function public.sync_verified_errebot_identity_to_imported_players()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_member public.club_members%rowtype;
  target_club_name text;
begin
  if new.source <> 'errebot'
    or new.status <> 'verified'
    or new.member_id is null then
    return new;
  end if;

  select member.*
  into target_member
  from public.club_members as member
  where member.id = new.member_id
    and member.is_active;

  if target_member.id is null then
    return new;
  end if;

  select club.name
  into target_club_name
  from public.clubs as club
  where club.id = target_member.club_id;

  -- Une même identité externe ne peut pas représenter deux joueurs du même
  -- tournoi importé.
  if exists (
    select 1
    from public.tournament_team_players as affected_player
    join public.tournament_import_team_refs as team_ref
      on team_ref.team_id = affected_player.team_id
    join public.tournament_imports as import_row
      on import_row.id = team_ref.import_id
     and import_row.tournament_id = affected_player.tournament_id
     and import_row.source = 'errebot'
     and import_row.status = 'imported'
    where affected_player.external_identity_id = new.id
    group by affected_player.tournament_id
    having count(*) > 1
  ) then
    raise exception 'Errebot identity appears more than once in the same imported tournament'
      using errcode = '23505';
  end if;

  -- Ne jamais créer un doublon de licencié dans une autre équipe active du
  -- même tournoi.
  if exists (
    select 1
    from public.tournament_team_players as affected_player
    join public.tournament_import_team_refs as team_ref
      on team_ref.team_id = affected_player.team_id
    join public.tournament_imports as import_row
      on import_row.id = team_ref.import_id
     and import_row.tournament_id = affected_player.tournament_id
     and import_row.source = 'errebot'
     and import_row.status = 'imported'
    join public.tournament_team_players as other_player
      on other_player.tournament_id = affected_player.tournament_id
     and other_player.id <> affected_player.id
     and other_player.member_id = target_member.id
    join public.tournament_teams as other_team
      on other_team.id = other_player.team_id
     and other_team.status in ('pending', 'accepted')
    where affected_player.external_identity_id = new.id
  ) then
    raise exception 'A verified member appears in more than one imported team'
      using errcode = '23505';
  end if;

  update public.tournament_team_players as player
  set
    member_id = target_member.id,
    first_name = target_member.first_name,
    last_name = target_member.last_name,
    club_name = coalesce(nullif(target_club_name, ''), player.club_name)
  where player.external_identity_id = new.id
    and exists (
      select 1
      from public.tournament_import_team_refs as team_ref
      join public.tournament_imports as import_row
        on import_row.id = team_ref.import_id
       and import_row.tournament_id = player.tournament_id
       and import_row.source = 'errebot'
       and import_row.status = 'imported'
      where team_ref.team_id = player.team_id
    );

  return new;
end;
$$;

drop trigger if exists sync_verified_errebot_identity_to_imported_players
on public.tournament_external_player_identities;

create trigger sync_verified_errebot_identity_to_imported_players
after insert or update of status, member_id, profile_id
on public.tournament_external_player_identities
for each row
execute function public.sync_verified_errebot_identity_to_imported_players();

revoke all on function public.sync_verified_errebot_identity_to_imported_players()
from public, anon, authenticated;

comment on function public.sync_verified_errebot_identity_to_imported_players() is
  'Répercute une identité Errebot vérifiée sur les joueurs des tournois déjà importés, sans modifier la structure sportive.';

commit;
