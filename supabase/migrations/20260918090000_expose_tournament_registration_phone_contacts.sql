begin;

create or replace function public.get_my_tournament_player_contacts()
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  with my_teams as (
    select distinct
      team.id as team_id,
      team.tournament_id
    from public.tournament_teams as team
    join public.tournaments as tournament
      on tournament.id = team.tournament_id
    where team.status in ('pending', 'accepted')
      and tournament.status not in ('completed', 'archived', 'cancelled')
      and public.tournament_profile_is_linked_to_team(team.id, auth.uid())
  ),
  allowed_teams as (
    select mine.tournament_id, mine.team_id
    from my_teams as mine

    union

    select
      mine.tournament_id,
      case
        when match.team_a_id = mine.team_id then match.team_b_id
        else match.team_a_id
      end as team_id
    from my_teams as mine
    join public.tournament_matches as match
      on match.tournament_id = mine.tournament_id
     and mine.team_id in (match.team_a_id, match.team_b_id)
    where case
        when match.team_a_id = mine.team_id then match.team_b_id
        else match.team_a_id
      end is not null
      and exists (
        select 1
        from public.tournament_match_events as event_link
        join public.events as event
          on event.id = event_link.event_id
        where event_link.match_id = match.id
          and event.publication_status = 'published'
      )
  ),
  contacts as (
    select
      allowed.tournament_id,
      player.team_id,
      player.role::text as role,
      player.first_name,
      player.last_name,
      coalesce(
        nullif(btrim(member.phone), ''),
        case
          when identity.status = 'verified' then coalesce(
            nullif(btrim(identity_member.phone), ''),
            nullif(btrim(profile_member.phone), '')
          )
          else null
        end,
        nullif(btrim(player.phone), '')
      ) as phone,
      case
        when nullif(btrim(member.phone), '') is not null then 'verified'
        when identity.status = 'verified'
          and coalesce(
            nullif(btrim(identity_member.phone), ''),
            nullif(btrim(profile_member.phone), '')
          ) is not null then 'verified'
        when nullif(btrim(player.phone), '') is not null then 'registration'
        else null
      end as contact_kind
    from allowed_teams as allowed
    join public.tournament_team_players as player
      on player.team_id = allowed.team_id
     and player.tournament_id = allowed.tournament_id
    left join public.club_members as member
      on member.id = player.member_id
    left join public.tournament_external_player_identities as identity
      on identity.id = player.external_identity_id
    left join public.club_members as identity_member
      on identity_member.id = identity.member_id
    left join public.profiles as identity_profile
      on identity_profile.id = identity.profile_id
    left join public.club_members as profile_member
      on profile_member.id = identity_profile.member_id
  )
  select coalesce(
    jsonb_agg(
      jsonb_build_object(
        'tournament_id', contact.tournament_id,
        'team_id', contact.team_id,
        'role', contact.role,
        'first_name', contact.first_name,
        'last_name', contact.last_name,
        'phone', contact.phone,
        'contact_kind', contact.contact_kind
      )
      order by
        contact.tournament_id,
        contact.team_id,
        contact.last_name,
        contact.first_name
    ) filter (where contact.phone is not null),
    '[]'::jsonb
  )
  from contacts as contact;
$$;

revoke all on function public.get_my_tournament_player_contacts()
from public, anon, authenticated;
grant execute on function public.get_my_tournament_player_contacts()
to authenticated;

comment on function public.get_my_tournament_player_contacts() is
  'Contacts visibles par un participant pour sa propre équipe et les adversaires de ses matchs publiés dans les tournois actifs. Les numéros issus d’une fiche licencié ou d’une identité vérifiée sont marqués verified ; les numéros bruts saisis à l’inscription sont marqués registration afin de ne pas les présenter comme une identité personnelle certifiée.';

commit;
