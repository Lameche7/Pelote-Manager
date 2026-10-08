-- #327 Referee is authorized by CURRENT venue/time, not immutable match id.
create or replace function public.referee_submit_tournament_result(target_match_id uuid,score_payload jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare actor uuid:=auth.uid(); target_match public.tournament_matches%rowtype; target_tournament public.tournaments%rowtype; pl public.tournament_match_planning%rowtype; tz text; calculated jsonb; saved uuid;
begin
 select m.* into target_match from public.tournament_matches m where m.id=target_match_id for update;
 if actor is null or target_match.id is null or not exists(
   select 1 from public.refereeing_current_match_slot('tournament',target_match_id) slot
   join public.referee_slot_assignments ra on ra.club_id=slot.club_id
    and ra.resource_id=slot.resource_id and ra.starts_at=slot.starts_at and ra.ends_at=slot.ends_at
   where ra.referee_profile_id=actor
 ) then raise exception 'Seul l arbitre désigné peut saisir ce résultat' using errcode='42501'; end if;
 select * into target_tournament from public.tournaments where id=target_match.tournament_id;
 if target_tournament.status not in ('planning_published','in_progress') then raise exception 'Saisie indisponible à cette étape'; end if;
 select * into pl from public.tournament_match_planning where match_id=target_match_id;
 if pl.match_id is null then raise exception 'Partie non programmée'; end if;
 select r.timezone into tz from public.reservable_resources r where r.id=pl.resource_id;
 if public.tournament_planning_starts_at(pl.play_date,pl.ends_at,tz)>now() then raise exception 'La partie doit être terminée'; end if;
 if exists(select 1 from public.tournament_match_results where match_id=target_match_id) then raise exception 'Un résultat existe déjà'; end if;
 calculated:=public.tournament_calculate_match_result(target_match_id,score_payload);
 insert into public.tournament_match_results(match_id,tournament_id,status,score,team_a_sets,team_b_sets,team_a_points,team_b_points,team_a_ranking_points,team_b_ranking_points,winner_team_id,submitted_by,submitted_at,updated_at)
 values(target_match_id,target_match.tournament_id,'pending_validation',calculated->'score',(calculated->>'team_a_sets')::integer,(calculated->>'team_b_sets')::integer,(calculated->>'team_a_points')::integer,(calculated->>'team_b_points')::integer,(calculated->>'team_a_ranking_points')::integer,(calculated->>'team_b_ranking_points')::integer,(calculated->>'winner_team_id')::uuid,actor,now(),now()) returning id into saved;
 insert into public.tournament_audit_log(tournament_id,action,before_status,after_status,payload,created_by) values(target_match.tournament_id,'match_result_submitted_by_referee',target_tournament.status,target_tournament.status,jsonb_build_object('match_id',target_match_id,'result_id',saved,'score',calculated->'score'),actor);
 return saved;
end;$$;
revoke all on function public.referee_submit_tournament_result(uuid,jsonb) from public;
grant execute on function public.referee_submit_tournament_result(uuid,jsonb) to authenticated;