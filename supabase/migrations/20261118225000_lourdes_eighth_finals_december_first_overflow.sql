-- Lourdes 2026: the 1/8 deadline becomes 1 December (inclusive).
-- Preserve the normal early window as the engine's first preference,
-- and never schedule an eighth after a dependent, already planned quarter.
-- Other tournaments are unchanged.
begin;

update public.tournament_final_reschedule_deadlines
set last_play_date = date '2026-12-01'
where tournament_id = '3de17177-a915-404f-8a6e-14bf42158982'
  and final_round = 'round_of_16';

do $migration$
declare
  definition text;
begin
  definition := replace(
    pg_get_functiondef(
      'public.auto_assign_ready_tournament_final_slots(uuid,uuid)'::regprocedure
    ),
    chr(13),
    ''
  );
  if strpos(definition, '  latest_date date;') = 0
    or strpos(definition, '    if entry.final_round=''final'' then') = 0
    or strpos(definition, '    order by' || chr(10) || '      case when entry.preferred_date=slot.play_date') = 0
  then
    raise exception 'The automatic final scheduler has changed: inspect before patching';
  end if;

  definition := replace(
    definition,
    '  latest_date date;',
    '  latest_date date;' || chr(10) ||
    '  regular_latest_date date;' || chr(10) ||
    '  next_round_deadline date;'
  );

  definition := replace(
    definition,
    '    if entry.final_round=''final'' then',
    $patch$
    regular_latest_date := latest_date;
    if entry.final_round = 'round_of_16' then
      -- The late window is only an overflow, and only for an opted-in
      -- tournament with an explicit later rescheduling deadline.
      latest_date := greatest(
        latest_date,
        coalesce(
          public.tournament_final_reschedule_last_play_date(
            target_tournament_id, 'round_of_16'
          ),
          latest_date
        )
      );

      -- A real already-planned downstream match must remain later than
      -- its feeder; ignore purely provisional bracket placeholders.
      select min(next_plan.play_date - 1)
      into next_round_deadline
      from public.tournament_matches next_match
      join public.tournament_match_planning next_plan
        on next_plan.match_id = next_match.id
      where next_match.tournament_id = target_tournament_id
        and next_match.series_id = entry.series_id
        and next_match.phase = 'finals'
        and next_match.final_round_number > entry.final_round_number
        and public.tournament_final_node_depends_on(
          entry.series_id,
          next_match.final_round_number, next_match.display_order,
          entry.final_round_number, entry.display_order
        );
      if next_round_deadline is not null then
        latest_date := least(latest_date, next_round_deadline);
      end if;
    end if;
    if entry.final_round='final' then$patch$
  );

  definition := replace(
    definition,
    '    order by' || chr(10) ||
    '      case when entry.preferred_date=slot.play_date',
    $patch$
    order by
      -- Prefer the standard window over an overflow, even when the
      -- provisional slot was previously set on a later date.
      case
        when entry.final_round = 'round_of_16'
          and slot.play_date > regular_latest_date
        then 1 else 0
      end,
      case when entry.preferred_date=slot.play_date$patch$
  );
  execute definition;
end;
$migration$;

commit;
