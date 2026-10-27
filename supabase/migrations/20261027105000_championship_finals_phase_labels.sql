-- Provide the actual knockout round to the admin results screen without changing v2 callers.
create or replace function public.admin_list_championship_day_results_v3(target_id uuid)
returns jsonb
language sql stable security definer set search_path = ''
as $$
  select coalesce(
    jsonb_agg(to_jsonb(result_row) || jsonb_build_object('phase', match.phase)),
    '[]'::jsonb
  )
  from public.admin_list_championship_day_results_v2(target_id) as result_row
  join public.championship_matches as match on match.id = result_row.match_id;
$$;
revoke all on function public.admin_list_championship_day_results_v3(uuid) from public, anon;
grant execute on function public.admin_list_championship_day_results_v3(uuid) to authenticated;

-- Existing calendar display carries name and division as newline-separated lines.
-- Enrich the division line with the actual phase, preserving the rest of the function.
do $$
declare
  function_source text;
  old_fragment text := '      division.name,' || chr(10);
  new_fragment text := '      concat_ws('' · '', division.name, match.phase),' || chr(10);
begin
  select pg_get_functiondef(p.oid) into function_source
  from pg_proc p join pg_namespace n on n.oid = p.pronamespace
  where n.nspname = 'public' and p.proname = 'list_available_slots_v4'
    and pg_get_function_identity_arguments(p.oid) = 'target_resource_id uuid, range_start date, range_end date';
  if function_source is null then
    raise exception 'list_available_slots_v4 not found; migration aborted';
  end if;
  if position(old_fragment in function_source) = 0 then
    raise exception 'Expected division label not found; migration aborted';
  end if;
  function_source := replace(function_source, old_fragment, new_fragment);
  execute function_source;
end $$;
