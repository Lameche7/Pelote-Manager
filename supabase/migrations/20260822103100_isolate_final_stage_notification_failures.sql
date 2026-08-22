begin;

-- Une panne du moteur de communications ne doit jamais empêcher la publication
-- sportive d'un tour de phase finale. Chaque équipe est notifiée indépendamment.
create or replace function public.notify_tournament_final_match_publication()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_match public.tournament_matches;
begin
  select match.*
  into target_match
  from public.tournament_matches as match
  where match.id = new.match_id;

  if target_match.id is null or target_match.phase <> 'finals' then
    return new;
  end if;

  begin
    perform public.publish_tournament_final_match_publication_notification(
      target_match.id,
      target_match.team_a_id
    );
  exception when others then
    null;
  end;

  begin
    perform public.publish_tournament_final_match_publication_notification(
      target_match.id,
      target_match.team_b_id
    );
  exception when others then
    null;
  end;

  return new;
end;
$$;

revoke all on function public.notify_tournament_final_match_publication()
from public, anon, authenticated;

commit;
