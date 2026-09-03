begin;

-- PR129 — Le classeur réel Bizanos contient près de 23 000 disponibilités.
-- Même avec une validation SQL ensembliste, envoyer une ligne JSON complète par
-- disponibilité produit une requête de plusieurs mégaoctets. Le navigateur
-- envoie désormais les identifiants de créneaux groupés par équipe/phase ; la
-- base reconstruit les lignes détaillées localement avant de réutiliser les RPC
-- de validation/import existantes.

create or replace function public.expand_errebot_availability_compact_payload(
  payload jsonb
)
returns jsonb
language sql
stable
security invoker
set search_path = ''
as $$
  with
  source_input as (
    select
      btrim(coalesce(source.value->>'phase', '')) as phase,
      btrim(coalesce(source.value->>'play_date', '')) as play_date,
      btrim(coalesce(source.value->>'starts_at', '')) as starts_at,
      btrim(coalesce(source.value->>'ends_at', '')) as ends_at,
      nullif(btrim(coalesce(source.value->>'source_slot_id', '')), '') as source_slot_id
    from jsonb_array_elements(
      case
        when jsonb_typeof(payload->'source_slots') = 'array'
          then payload->'source_slots'
        else '[]'::jsonb
      end
    ) as source(value)
  ),
  availability_group as (
    select
      btrim(coalesce(group_row.value->>'external_team_id', '')) as external_team_id,
      btrim(coalesce(group_row.value->>'phase', '')) as phase,
      case
        when jsonb_typeof(group_row.value->'source_slot_ids') = 'array'
          then group_row.value->'source_slot_ids'
        else '[]'::jsonb
      end as source_slot_ids
    from jsonb_array_elements(
      case
        when jsonb_typeof(payload->'availability_by_team') = 'array'
          then payload->'availability_by_team'
        else '[]'::jsonb
      end
    ) as group_row(value)
  ),
  selected_slot as (
    select
      availability_group.external_team_id,
      availability_group.phase,
      slot_id.value as source_slot_id
    from availability_group
    cross join lateral jsonb_array_elements_text(
      availability_group.source_slot_ids
    ) as slot_id(value)
  ),
  expanded_row as (
    select
      selected_slot.external_team_id,
      selected_slot.phase,
      source_input.play_date,
      source_input.starts_at,
      source_input.ends_at
    from selected_slot
    join source_input
      on source_input.phase = selected_slot.phase
     and source_input.source_slot_id = selected_slot.source_slot_id
  ),
  expanded_rows_json as (
    select coalesce(
      jsonb_agg(
        jsonb_build_object(
          'external_team_id', external_team_id,
          'phase', phase,
          'play_date', play_date,
          'starts_at', starts_at,
          'ends_at', ends_at
        )
        order by external_team_id, phase, play_date, starts_at
      ),
      '[]'::jsonb
    ) as value
    from expanded_row
  )
  select
    case
      when jsonb_typeof(payload->'availability_by_team') = 'array'
        then (payload - 'availability_by_team')
          || jsonb_build_object('rows', expanded_rows_json.value)
      else payload
    end
  from expanded_rows_json;
$$;

revoke all on function public.expand_errebot_availability_compact_payload(jsonb)
from public, anon, authenticated;

create or replace function public.admin_preview_errebot_availability_import_compact(
  target_tournament_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  return public.admin_preview_errebot_availability_import(
    target_tournament_id,
    public.expand_errebot_availability_compact_payload(payload)
  );
end;
$$;

create or replace function public.admin_import_errebot_availability_compact(
  target_tournament_id uuid,
  payload jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
begin
  return public.admin_import_errebot_availability(
    target_tournament_id,
    public.expand_errebot_availability_compact_payload(payload)
  );
end;
$$;

revoke all on function public.admin_preview_errebot_availability_import_compact(uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.admin_import_errebot_availability_compact(uuid, jsonb)
from public, anon, authenticated;

grant execute on function public.admin_preview_errebot_availability_import_compact(uuid, jsonb)
to authenticated;
grant execute on function public.admin_import_errebot_availability_compact(uuid, jsonb)
to authenticated;

commit;
