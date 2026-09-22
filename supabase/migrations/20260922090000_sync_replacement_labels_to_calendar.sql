begin;

create or replace function public.sync_tournament_team_calendar_labels(
  target_team_id uuid
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  item record;
  synced_count integer := 0;
begin
  perform set_config('app.allow_tournament_event_sync', 'on', true);

  for item in
    select
      link.event_id,
      concat(
        series.name,
        ' · ',
        public.tournament_team_public_label(match.team_a_id),
        ' — ',
        public.tournament_team_public_label(match.team_b_id)
      ) as display_name
    from public.tournament_matches as match
    join public.tournament_series as series on series.id = match.series_id
    join public.tournament_match_events as link on link.match_id = match.id
    where match.team_a_id = target_team_id
       or match.team_b_id = target_team_id
    order by link.event_id
  loop
    update public.events as event
    set
      name = item.display_name,
      updated_by = coalesce(auth.uid(), event.updated_by),
      updated_at = now()
    where event.id = item.event_id
      and event.publication_status = 'published';

    if found then
      update public.calendar_occupations as occupation
      set
        title = item.display_name,
        updated_by = coalesce(auth.uid(), occupation.updated_by),
        updated_at = now()
      from public.event_resources as event_resource
      where event_resource.event_id = item.event_id
        and event_resource.calendar_occupation_id = occupation.id
        and occupation.cancelled_at is null;

      synced_count := synced_count + 1;
    end if;
  end loop;

  return synced_count;
end;
$$;

revoke all on function public.sync_tournament_team_calendar_labels(uuid)
from public, anon, authenticated;

do $migration$
declare
  function_definition text;
  patched_definition text;
  old_fragment text := $old$
  where team.id = target_team.id;

  insert into public.tournament_audit_log (
$old$;
  new_fragment text := $new$
  where team.id = target_team.id;

  perform public.sync_tournament_team_calendar_labels(target_team.id);

  insert into public.tournament_audit_log (
$new$;
begin
  function_definition := replace(
    pg_get_functiondef(
      'public.admin_replace_tournament_player(uuid,text,jsonb,text)'::regprocedure
    ),
    chr(13),
    ''
  );

  if position(old_fragment in function_definition) = 0 then
    raise exception 'Tournament replacement calendar sync insertion point changed unexpectedly';
  end if;

  patched_definition := replace(function_definition, old_fragment, new_fragment);
  execute patched_definition;
end;
$migration$;

comment on function public.sync_tournament_team_calendar_labels(uuid) is
  'Synchronise le libellé public des matchs publiés d une équipe vers events et calendar_occupations après une correction de joueurs.';

commit;
