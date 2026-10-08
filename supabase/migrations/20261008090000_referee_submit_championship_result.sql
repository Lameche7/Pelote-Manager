create or replace function public.referee_submit_championship_result(target_match_id uuid,target_score_team1 integer,target_score_team2 integer)
returns jsonb language plpgsql security definer set search_path='' as $$
declare v_actor uuid:=auth.uid(); v_club uuid; v_match public.championship_matches%rowtype; v_champ uuid; v_mode text; v_win integer; v_team uuid; v_submission uuid; v_end timestamptz;
begin
 select ra.club_id into v_club from public.referee_assignments ra where ra.championship_match_id=target_match_id and ra.referee_profile_id=v_actor;
 if v_actor is null or v_club is null then raise exception 'Seul l arbitre désigné peut saisir ce résultat' using errcode='42501'; end if;
 select * into v_match from public.championship_matches where id=target_match_id;
 if v_match.id is null then raise exception 'Partie introuvable'; end if;
 select c.id,c.result_input_mode,c.result_winning_score into v_champ,v_mode,v_win from public.championship_divisions d join public.championships c on c.id=d.championship_id where d.id=v_match.division_id;
 if not exists(select 1 from public.championship_club_links l where l.championship_id=v_champ and l.club_id=v_club) then raise exception 'Championnat non lié au club'; end if;
 select r.ends_at into v_end from public.reservations r join public.reservable_resources rr on rr.id=r.resource_id where r.championship_match_id=target_match_id and rr.club_id=v_club and r.status in ('pending','confirmed') order by r.starts_at limit 1;
 if v_end is null or v_end>now() then raise exception 'La partie doit être terminée avant la saisie'; end if;
 if v_match.status in ('cancelled','forfeit') or v_match.score_raw is not null or v_match.score_team1 is not null or v_match.score_team2 is not null then raise exception 'Résultat officiel déjà enregistré ou partie indisponible'; end if;
 if v_win is null or target_score_team1 is null or target_score_team2 is null or target_score_team1<0 or target_score_team2<0 or target_score_team1=target_score_team2 or greatest(target_score_team1,target_score_team2)<>v_win or least(target_score_team1,target_score_team2)>=v_win then raise exception 'Score invalide pour ce championnat'; end if;
 select t.id into v_team from public.championship_teams t join public.championship_federation_clubs fc on fc.id=t.federation_club_id where t.id in (v_match.team1_id,v_match.team2_id) and fc.linked_club_id=v_club limit 1;
 if v_team is null then raise exception 'Aucune équipe du club pour cette rencontre'; end if;
 if exists(select 1 from public.championship_result_submissions s where s.match_id=target_match_id and s.status='pending') then raise exception 'Un résultat est déjà en attente de validation'; end if;
 insert into public.championship_result_submissions(match_id,team_id,submitted_by,score_team1,score_team2,comment)
 values(target_match_id,v_team,v_actor,target_score_team1,target_score_team2,'Saisi par l arbitre désigné') returning id into v_submission;
 insert into public.championship_audit_log(championship_id,actor_id,action,payload)
 values(v_champ,v_actor,'result_submission.referee_created',jsonb_build_object('submissionId',v_submission,'matchId',target_match_id,'clubId',v_club));
 return jsonb_build_object('id',v_submission,'status','pending');
end;$$;
revoke all on function public.referee_submit_championship_result(uuid,integer,integer) from public;
grant execute on function public.referee_submit_championship_result(uuid,integer,integer) to authenticated;