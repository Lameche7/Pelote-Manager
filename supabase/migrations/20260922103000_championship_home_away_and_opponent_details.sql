begin;

-- Enrichit Mes championnats avec le club et la composition complète de
-- l'adversaire, tout en conservant les téléphones dans le RPC dédié aux
-- contacts. L'ordre fédéral Equipe1 / Equipe2 devient aussi la règle métier
-- domicile / extérieur : seule Equipe1 peut réserver le terrain.

do $migration$
declare
  definition text;
  patched text;
  old_fragment text := $old$
                'opponent_label', case when match.team1_id = mine.team_id then opponent2.source_label else opponent1.source_label end,
                'scheduled_on', match.scheduled_on,
$old$;
  new_fragment text := $new$
                'opponent_label', case when match.team1_id = mine.team_id then opponent2.source_label else opponent1.source_label end,
                'opponent_club_name', case
                  when match.team1_id = mine.team_id then opponent_club2.name
                  else opponent_club1.name
                end,
                'opponent_players', (
                  select coalesce(
                    jsonb_agg(
                      jsonb_build_object(
                        'first_name', opponent_player.first_name,
                        'last_name', opponent_player.last_name
                      )
                      order by opponent_player.last_name, opponent_player.first_name
                    ),
                    '[]'::jsonb
                  )
                  from public.championship_team_players as opponent_team_player
                  join public.championship_players as opponent_player
                    on opponent_player.id = opponent_team_player.player_id
                  where opponent_team_player.team_id = case
                    when match.team1_id = mine.team_id then match.team2_id
                    else match.team1_id
                  end
                ),
                'scheduled_on', match.scheduled_on,
$new$;
  join_old text := $joinold$
          left join public.championship_teams as opponent1 on opponent1.id = match.team1_id
          left join public.championship_teams as opponent2 on opponent2.id = match.team2_id
          where mine.team_id in (match.team1_id, match.team2_id)
$joinold$;
  join_new text := $joinnew$
          left join public.championship_teams as opponent1 on opponent1.id = match.team1_id
          left join public.championship_teams as opponent2 on opponent2.id = match.team2_id
          left join public.championship_federation_clubs as opponent_club1
            on opponent_club1.id = opponent1.federation_club_id
          left join public.championship_federation_clubs as opponent_club2
            on opponent_club2.id = opponent2.federation_club_id
          where mine.team_id in (match.team1_id, match.team2_id)
$joinnew$;
begin
  definition := replace(
    pg_get_functiondef('public.get_my_championships()'::regprocedure),
    chr(13),
    ''
  );

  if position(old_fragment in definition) = 0
    or position(join_old in definition) = 0 then
    raise exception 'get_my_championships structure changed unexpectedly';
  end if;

  patched := replace(definition, old_fragment, new_fragment);
  patched := replace(patched, join_old, join_new);
  execute patched;
end;
$migration$;

do $migration$
declare
  definition text;
  patched text;
  old_fragment text := $old$
      where player.profile_id = actor_id
        and player.link_status in ('claimed', 'verified')
        and team_player.team_id in (match.team1_id, match.team2_id)
    );
$old$;
  new_fragment text := $new$
      where player.profile_id = actor_id
        and player.link_status in ('claimed', 'verified')
        and team_player.team_id = match.team1_id
    );
$new$;
begin
  definition := replace(
    pg_get_functiondef(
      'public.get_my_championship_reservation_context(uuid)'::regprocedure
    ),
    chr(13),
    ''
  );

  if position(old_fragment in definition) = 0 then
    raise exception 'Championship reservation context structure changed unexpectedly';
  end if;

  patched := replace(definition, old_fragment, new_fragment);
  execute patched;
end;
$migration$;

do $migration$
declare
  definition text;
  patched text;
  old_fragment text := $old$
    case
      when exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player
          on player.id = team_player.player_id
        where player.profile_id = actor_id
          and player.link_status in ('claimed', 'verified')
          and team_player.team_id = match.team1_id
      ) then match.team1_id
      when exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player
          on player.id = team_player.player_id
        where player.profile_id = actor_id
          and player.link_status in ('claimed', 'verified')
          and team_player.team_id = match.team2_id
      ) then match.team2_id
      else null
    end,
$old$;
  new_fragment text := $new$
    case
      when exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player
          on player.id = team_player.player_id
        where player.profile_id = actor_id
          and player.link_status in ('claimed', 'verified')
          and team_player.team_id = match.team1_id
      ) then match.team1_id
      else null
    end,
$new$;
begin
  definition := replace(
    pg_get_functiondef(
      'public.link_my_championship_match_reservation(uuid,uuid)'::regprocedure
    ),
    chr(13),
    ''
  );

  if position(old_fragment in definition) = 0 then
    raise exception 'Championship reservation link structure changed unexpectedly';
  end if;

  patched := replace(definition, old_fragment, new_fragment);
  execute patched;
end;
$migration$;

do $migration$
declare
  definition text;
  patched text;
  old_fragment text := $old$
    case
      when exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player
          on player.id = team_player.player_id
        where player.profile_id = new.user_id
          and player.link_status in ('claimed', 'verified')
          and team_player.team_id = match.team1_id
      ) then match.team1_id
      when exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player
          on player.id = team_player.player_id
        where player.profile_id = new.user_id
          and player.link_status in ('claimed', 'verified')
          and team_player.team_id = match.team2_id
      ) then match.team2_id
      else null
    end
$old$;
  new_fragment text := $new$
    case
      when exists (
        select 1
        from public.championship_team_players as team_player
        join public.championship_players as player
          on player.id = team_player.player_id
        where player.profile_id = new.user_id
          and player.link_status in ('claimed', 'verified')
          and team_player.team_id = match.team1_id
      ) then match.team1_id
      else null
    end
$new$;
begin
  definition := replace(
    pg_get_functiondef(
      'public.validate_championship_match_reservation()'::regprocedure
    ),
    chr(13),
    ''
  );

  if position(old_fragment in definition) = 0 then
    raise exception 'Championship reservation trigger structure changed unexpectedly';
  end if;

  patched := replace(definition, old_fragment, new_fragment);
  execute patched;
end;
$migration$;

comment on function public.get_my_championships() is
  'Retourne les championnats du joueur avec côté Equipe1/Equipe2, club adverse et composition adverse.';
comment on function public.get_my_championship_reservation_context(uuid) is
  'Retourne le contexte de réservation uniquement aux joueurs de l Equipe1, équipe qui reçoit.';
comment on function public.link_my_championship_match_reservation(uuid, uuid) is
  'Lie une réservation de championnat uniquement pour l Equipe1, équipe qui reçoit.';

commit;
