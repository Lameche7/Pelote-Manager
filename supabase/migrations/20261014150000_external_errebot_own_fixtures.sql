-- Return only fixtures involving the authenticated user's verified external teams.
create or replace function public.list_my_external_errebot_tournaments()
returns jsonb language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(jsonb_build_object(
 'id',t.id,'name',t.title,'venueName',t.venue_name,
 'fixtures',(
   select coalesce(jsonb_agg(f.value order by f.ordinality),'[]'::jsonb)
   from jsonb_array_elements(t.content->'fixtures') with ordinality f(value,ordinality)
   where exists (
      select 1 from public.external_errebot_participants ep
      where ep.tournament_id=t.id and ep.profile_id=auth.uid()
        and ep.external_team_id in (f.value->>'team1ExternalId',f.value->>'team2ExternalId')
   )
 ),
 'pools',t.content->'pools',
 'teams',(
   select coalesce(jsonb_agg(jsonb_build_object(
     'externalId',team.value->>'externalId',
     'players',(
       select coalesce(jsonb_agg(jsonb_build_object(
         'firstName',player.value->>'firstName','lastName',player.value->>'lastName'
       )),'[]'::jsonb)
       from jsonb_array_elements(team.value->'players') player
     )
   )),'[]'::jsonb)
   from jsonb_array_elements(t.content->'teams') team
   where exists (
     select 1 from jsonb_array_elements(t.content->'fixtures') f
     join public.external_errebot_participants ep
       on ep.tournament_id=t.id and ep.profile_id=auth.uid()
     where ep.external_team_id in (f->>'team1ExternalId',f->>'team2ExternalId')
       and team.value->>'externalId' in (f->>'team1ExternalId',f->>'team2ExternalId')
   )
 )
) order by t.created_at desc),'[]'::jsonb)
from public.external_errebot_tournaments t
where exists (
 select 1 from public.external_errebot_participants ep
 where ep.tournament_id=t.id and ep.profile_id=auth.uid()
)
$$;
revoke all on function public.list_my_external_errebot_tournaments() from public,anon;
grant execute on function public.list_my_external_errebot_tournaments() to authenticated;
