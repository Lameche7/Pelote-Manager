create or replace function public.resolve_calendar_competition(
 target_resource_id uuid, target_starts_at timestamptz, target_ends_at timestamptz
) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare result_identity jsonb; match_uuid uuid; competition_uuid uuid; kind text;
begin
 if auth.uid() is null then return null; end if;
 result_identity := public.resolve_calendar_player_actions(target_resource_id,target_starts_at,target_ends_at);
 kind := result_identity->>'kind';
 if kind not in ('tournament','championship') then return null; end if;
 match_uuid := (result_identity->>'matchId')::uuid;
 if kind='tournament' then
  select tournament_id into competition_uuid from public.tournament_matches where id=match_uuid;
 else
  select d.championship_id into competition_uuid
    from public.championship_matches m join public.championship_divisions d on d.id=m.division_id
    where m.id=match_uuid;
 end if;
 if competition_uuid is null then return null; end if;
 return jsonb_build_object('kind',kind,'matchId',match_uuid,'competitionId',competition_uuid);
end $$;
revoke all on function public.resolve_calendar_competition(uuid,timestamptz,timestamptz) from public,anon;
grant execute on function public.resolve_calendar_competition(uuid,timestamptz,timestamptz) to authenticated;
