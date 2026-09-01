begin;

-- PR125 — permet de corriger les options d'un tournoi Errebot déjà publié.
-- Si le même fichier a déjà créé un tournoi en planning_published, on retire
-- d'abord son planning du calendrier dans la même transaction, puis on réutilise
-- le RPC de configuration existant. Toute erreur annule aussi la dépublication.

create or replace function public.admin_import_errebot_tournament_reconfigurable(
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_club_id uuid := public.admin_current_club_id();
  input_file_hash text := lower(btrim(coalesce(payload->'file'->>'hash', '')));
  existing_tournament_id uuid;
  existing_tournament_status public.tournament_status;
  planning_was_unpublished boolean := false;
  import_result jsonb;
begin
  if auth.uid() is null then
    raise exception 'Authentication required' using errcode = '42501';
  end if;

  if not public.has_club_permission(target_club_id, 'tournaments.manage') then
    raise exception 'Forbidden' using errcode = '42501';
  end if;

  if input_file_hash ~ '^[0-9a-f]{64}$' then
    select
      import_row.tournament_id,
      tournament.status
    into
      existing_tournament_id,
      existing_tournament_status
    from public.tournament_imports as import_row
    join public.tournaments as tournament
      on tournament.id = import_row.tournament_id
     and tournament.club_id = target_club_id
    where import_row.club_id = target_club_id
      and import_row.source = 'errebot'
      and import_row.source_file_hash = input_file_hash
      and import_row.status = 'imported'
      and import_row.tournament_id is not null
    order by import_row.imported_at desc nulls last, import_row.created_at desc
    limit 1
    for update of import_row, tournament;
  end if;

  if existing_tournament_id is not null then
    if existing_tournament_status = 'planning_published' then
      perform public.admin_unpublish_tournament_planning(existing_tournament_id);
      planning_was_unpublished := true;
    elsif existing_tournament_status <> 'planning_generated' then
      raise exception 'Imported Errebot tournament options are locked after publication'
        using errcode = 'P0001';
    end if;
  end if;

  import_result := public.admin_import_errebot_tournament_configured(payload);

  return import_result || jsonb_build_object(
    'planningWasUnpublished', planning_was_unpublished
  );
end;
$$;

revoke all on function public.admin_import_errebot_tournament_reconfigurable(jsonb)
from public, anon, authenticated;
grant execute on function public.admin_import_errebot_tournament_reconfigurable(jsonb)
to authenticated;

commit;
