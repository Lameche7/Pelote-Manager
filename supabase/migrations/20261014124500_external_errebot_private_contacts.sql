-- Only expose public sporting fields to authenticated tournament participants.
-- Never expose imported PDF phone numbers to another participant.
create or replace function public.list_my_external_errebot_tournaments()
returns jsonb language sql stable security definer set search_path='' as $$
select coalesce(jsonb_agg(
 jsonb_build_object(
  'id',t.id,'name',t.title,'venueName',t.venue_name,
  'fixtures',t.content->'fixtures',
  'pools',t.content->'pools',
  'teams',(
    select coalesce(jsonb_agg(jsonb_build_object(
      'externalId',team.value->>'externalId',
      'players',(
        select coalesce(jsonb_agg(jsonb_build_object(
          'firstName',player.value->>'firstName',
          'lastName',player.value->>'lastName'
        )),'[]'::jsonb)
        from jsonb_array_elements(team.value->'players') player
      )
    )),'[]'::jsonb)
    from jsonb_array_elements(t.content->'teams') team
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
