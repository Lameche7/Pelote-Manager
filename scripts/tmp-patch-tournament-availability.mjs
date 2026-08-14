import fs from "node:fs";

const read = (path) => fs.readFileSync(path, "utf8");
const write = (path, content) => fs.writeFileSync(path, content, "utf8");
const replaceOnce = (path, from, to) => {
  const source = read(path);
  if (!source.includes(from)) {
    throw new Error(`Pattern not found in ${path}: ${from.slice(0, 100)}`);
  }
  write(path, source.replace(from, to));
};

const gridPath = "src/features/tournaments/components/TournamentAvailabilityGrid.tsx";
replaceOnce(
  gridPath,
  'import { TOURNAMENT_FINALS_MINIMUM_AVAILABILITY_SLOTS } from "@/features/tournaments/domain/tournamentAvailabilityRules";\n',
  "",
);
replaceOnce(
  gridPath,
  "  minimumWeekendAvailabilitySlots: number;\n};",
  "  minimumWeekendAvailabilitySlots: number;\n  minimumFinalsAvailabilitySlots: number;\n};",
);
replaceOnce(
  gridPath,
  "    finalsSelected.length >= TOURNAMENT_FINALS_MINIMUM_AVAILABILITY_SLOTS;",
  "    finalsSelected.length >= tournament.minimumFinalsAvailabilitySlots;",
);
replaceOnce(
  gridPath,
  `  const toggleDay = (day: DayGroup, checked: boolean) => {\n    const next = new Set(selectedKeys);\n    for (const slot of day.slots) {\n      if (checked) next.add(slotKey(slot));\n      else next.delete(slotKey(slot));\n    }\n    emitKeys(next);\n  };\n\n  const duplicateWeek = (sourceIndex: number) => {`,
  `  const toggleDay = (day: DayGroup, checked: boolean) => {\n    const next = new Set(selectedKeys);\n    for (const slot of day.slots) {\n      if (checked) next.add(slotKey(slot));\n      else next.delete(slotKey(slot));\n    }\n    emitKeys(next);\n  };\n\n  const toggleWeek = (week: WeekGroup, checked: boolean) => {\n    const next = new Set(selectedKeys);\n    for (const day of week.days) {\n      for (const slot of day.slots) {\n        if (checked) next.add(slotKey(slot));\n        else next.delete(slotKey(slot));\n      }\n    }\n    emitKeys(next);\n  };\n\n  const duplicateWeek = (sourceIndex: number) => {`,
);
let grid = read(gridPath);
grid = grid.replaceAll(
  "TOURNAMENT_FINALS_MINIMUM_AVAILABILITY_SLOTS",
  "tournament.minimumFinalsAvailabilitySlots",
);
write(gridPath, grid);
replaceOnce(
  gridPath,
  `            const canDuplicate =\n              weekIndex < weeks.length - 1 &&\n              weeks[weekIndex + 1]?.phase === week.phase;\n            return (`,
  `            const canDuplicate =\n              weekIndex < weeks.length - 1 &&\n              weeks[weekIndex + 1]?.phase === week.phase;\n            const weekSlots = week.days.flatMap((day) => day.slots);\n            const weekAllSelected =\n              weekSlots.length > 0 &&\n              weekSlots.every((slot) => selectedKeys.has(slotKey(slot)));\n            return (`,
);
replaceOnce(
  gridPath,
  `                  {canDuplicate && (\n                    <button\n                      type="button"\n                      disabled={disabled}\n                      onClick={() => duplicateWeek(weekIndex)}\n                    >\n                      Dupliquer cette semaine → suivante\n                    </button>\n                  )}`,
  `                  <div className="tournament-availability-week__actions">\n                    <button\n                      type="button"\n                      disabled={disabled}\n                      onClick={() => toggleWeek(week, !weekAllSelected)}\n                    >\n                      {weekAllSelected\n                        ? "Tout décocher la semaine"\n                        : "Tout cocher la semaine"}\n                    </button>\n                    {canDuplicate && (\n                      <button\n                        type="button"\n                        disabled={disabled}\n                        onClick={() => duplicateWeek(weekIndex)}\n                      >\n                        Dupliquer cette semaine → suivante\n                      </button>\n                    )}\n                  </div>`,
);

const cssPath = "src/features/tournaments/components/TournamentAvailabilityGrid.css";
replaceOnce(
  cssPath,
  `.tournament-availability-week button:disabled {\n  cursor: not-allowed;\n  opacity: 0.55;\n}\n\n.tournament-availability-week__scroll {`,
  `.tournament-availability-week button:disabled {\n  cursor: not-allowed;\n  opacity: 0.55;\n}\n\n.tournament-availability-week__actions {\n  display: flex;\n  flex-wrap: wrap;\n  justify-content: flex-end;\n  gap: 0.4rem;\n}\n\n.tournament-availability-week__scroll {`,
);
replaceOnce(
  cssPath,
  `  .tournament-availability-grid__heading > strong,\n  .tournament-availability-week button {\n    width: fit-content;\n  }\n}`,
  `  .tournament-availability-grid__heading > strong,\n  .tournament-availability-week button {\n    width: fit-content;\n  }\n\n  .tournament-availability-week__actions {\n    justify-content: flex-start;\n  }\n}`,
);

const typesPath = "src/features/tournaments/types.ts";
let types = read(typesPath);
const publicNeedle = `  minimumAvailabilitySlots: number;\n  minimumWeekendAvailabilitySlots: number;\n  slotDurationMinutes: number;`;
if ((types.match(new RegExp(publicNeedle.replace(/[.*+?^${}()|[\\]\\]/g, "\\$&"), "g")) ?? []).length < 2) {
  // Fall back to deterministic two replacements below.
}
types = types.replace(
  publicNeedle,
  `  minimumAvailabilitySlots: number;\n  minimumWeekendAvailabilitySlots: number;\n  minimumFinalsAvailabilitySlots: number;\n  slotDurationMinutes: number;`,
);
types = types.replace(
  publicNeedle,
  `  minimumAvailabilitySlots: number;\n  minimumWeekendAvailabilitySlots: number;\n  minimumFinalsAvailabilitySlots: number;\n  slotDurationMinutes: number;`,
);
if (!types.includes("minimumFinalsAvailabilitySlots")) throw new Error("Types update failed");
write(typesPath, types);

const registrationPath = "src/features/tournaments/components/TournamentRegistrationForm.tsx";
replaceOnce(
  registrationPath,
  'import { TOURNAMENT_FINALS_MINIMUM_AVAILABILITY_SLOTS } from "@/features/tournaments/domain/tournamentAvailabilityRules";\n',
  "",
);
replaceOnce(
  registrationPath,
  `    finalsAvailabilitySlots.length >=\n      TOURNAMENT_FINALS_MINIMUM_AVAILABILITY_SLOTS;`,
  `    finalsAvailabilitySlots.length >=\n      tournament.minimumFinalsAvailabilitySlots;`,
);

const tournamentServicePath = "src/features/tournaments/services/tournamentService.ts";
replaceOnce(
  tournamentServicePath,
  `  "Tournament finals availability minimum not reached":\n    "Vous devez sélectionner au moins 35 créneaux disponibles pour la phase finale.",`,
  `  "Tournament finals availability minimum not reached":\n    "Le minimum de créneaux disponibles pour la phase finale n’est pas atteint.",`,
);
replaceOnce(
  tournamentServicePath,
  `      supabase.rpc("get_public_tournament_availability_grid", {\n        target_tournament_id: id,\n      }),`,
  `      supabase.rpc("get_public_tournament_availability_grid_with_finals_minimum", {\n        target_tournament_id: id,\n      }),`,
);
replaceOnce(
  tournamentServicePath,
  `      minimumWeekendAvailabilitySlots: Number(\n        availability.minimum_weekend ?? 0,\n      ),\n      slotDurationMinutes: Number(availability.slot_duration_minutes ?? 60),`,
  `      minimumWeekendAvailabilitySlots: Number(\n        availability.minimum_weekend ?? 0,\n      ),\n      minimumFinalsAvailabilitySlots: Number(\n        availability.minimum_finals ?? 35,\n      ),\n      slotDurationMinutes: Number(availability.slot_duration_minutes ?? 60),`,
);

const adminTeamServicePath = "src/features/admin/tournaments/services/adminTournamentTeamService.ts";
replaceOnce(
  adminTeamServicePath,
  `  "Tournament finals availability minimum not reached":\n    "Le minimum de 35 créneaux de la phase finale n’est pas atteint.",`,
  `  "Tournament finals availability minimum not reached":\n    "Le minimum de créneaux de la phase finale n’est pas atteint.",`,
);
replaceOnce(
  adminTeamServicePath,
  `      supabase.rpc("admin_get_tournament_dated_availability", {\n        target_tournament_id: tournamentId,\n      }),`,
  `      supabase.rpc(\n        "admin_get_tournament_dated_availability_with_finals_minimum",\n        { target_tournament_id: tournamentId },\n      ),`,
);
replaceOnce(
  adminTeamServicePath,
  `        minimumWeekendAvailabilitySlots: Number(\n          availability.minimum_weekend ?? 0,\n        ),\n        slotDurationMinutes: Number(availability.slot_duration_minutes ?? 60),`,
  `        minimumWeekendAvailabilitySlots: Number(\n          availability.minimum_weekend ?? 0,\n        ),\n        minimumFinalsAvailabilitySlots: Number(\n          availability.minimum_finals ?? 35,\n        ),\n        slotDurationMinutes: Number(availability.slot_duration_minutes ?? 60),`,
);

const adminServicePath = "src/features/admin/tournaments/services/tournamentAdminService.ts";
replaceOnce(
  adminServicePath,
  `  minimumAvailabilitySlots: number;\n  minimumWeekendAvailabilitySlots: number;\n  slotDurationMinutes: number;`,
  `  minimumAvailabilitySlots: number;\n  minimumWeekendAvailabilitySlots: number;\n  minimumFinalsAvailabilitySlots: number;\n  slotDurationMinutes: number;`,
);
replaceOnce(
  adminServicePath,
  `    minimumWeekendAvailabilitySlots: Number(\n      row.minimum_weekend_availability_slots ?? 0,\n    ),\n    slotDurationMinutes: Number(row.slot_duration_minutes ?? 60),`,
  `    minimumWeekendAvailabilitySlots: Number(\n      row.minimum_weekend_availability_slots ?? 0,\n    ),\n    minimumFinalsAvailabilitySlots: Number(\n      row.minimum_finals_availability_slots ?? 35,\n    ),\n    slotDurationMinutes: Number(row.slot_duration_minutes ?? 60),`,
);
replaceOnce(
  adminServicePath,
  `  minimum_availability_slots: draft.minimumAvailabilitySlots,\n  minimum_weekend_availability_slots: draft.minimumWeekendAvailabilitySlots,\n  slot_duration_minutes: draft.slotDurationMinutes,`,
  `  minimum_availability_slots: draft.minimumAvailabilitySlots,\n  minimum_weekend_availability_slots: draft.minimumWeekendAvailabilitySlots,\n  minimum_finals_availability_slots: draft.minimumFinalsAvailabilitySlots,\n  slot_duration_minutes: draft.slotDurationMinutes,`,
);
replaceOnce(
  adminServicePath,
  `    const { data, error } = await supabase.rpc("admin_get_tournament", {\n      target_id: id,\n    });`,
  `    const { data, error } = await supabase.rpc(\n      "admin_get_tournament_with_finals_minimum",\n      { target_id: id },\n    );`,
);
replaceOnce(
  adminServicePath,
  `    const { data, error } = await supabase.rpc("admin_create_tournament", {\n      payload: draftPayload(draft),\n    });`,
  `    const { data, error } = await supabase.rpc(\n      "admin_create_tournament_with_finals_minimum",\n      { payload: draftPayload(draft) },\n    );`,
);
replaceOnce(
  adminServicePath,
  `    const { error } = await supabase.rpc("admin_update_tournament", {\n      target_id: id,\n      payload: draftPayload(draft),\n    });`,
  `    const { error } = await supabase.rpc(\n      "admin_update_tournament_with_finals_minimum",\n      {\n        target_id: id,\n        payload: draftPayload(draft),\n      },\n    );`,
);

const adminPagePath = "src/features/admin/tournaments/pages/AdminTournamentsPage.tsx";
replaceOnce(
  adminPagePath,
  `  minimumAvailabilitySlots: number;\n  minimumWeekendAvailabilitySlots: number;\n  slotDurationMinutes: number;`,
  `  minimumAvailabilitySlots: number;\n  minimumWeekendAvailabilitySlots: number;\n  minimumFinalsAvailabilitySlots: number;\n  slotDurationMinutes: number;`,
);
replaceOnce(
  adminPagePath,
  `  minimumAvailabilitySlots: 65,\n  minimumWeekendAvailabilitySlots: 0,\n  slotDurationMinutes: 60,`,
  `  minimumAvailabilitySlots: 65,\n  minimumWeekendAvailabilitySlots: 0,\n  minimumFinalsAvailabilitySlots: 35,\n  slotDurationMinutes: 60,`,
);
replaceOnce(
  adminPagePath,
  `  minimumAvailabilitySlots: detail.minimumAvailabilitySlots,\n  minimumWeekendAvailabilitySlots: detail.minimumWeekendAvailabilitySlots,\n  slotDurationMinutes: detail.slotDurationMinutes,`,
  `  minimumAvailabilitySlots: detail.minimumAvailabilitySlots,\n  minimumWeekendAvailabilitySlots: detail.minimumWeekendAvailabilitySlots,\n  minimumFinalsAvailabilitySlots: detail.minimumFinalsAvailabilitySlots,\n  slotDurationMinutes: detail.slotDurationMinutes,`,
);
replaceOnce(
  adminPagePath,
  `    form.minimumAvailabilitySlots < 0 ||\n    form.minimumWeekendAvailabilitySlots < 0 ||\n    form.minimumWeekendAvailabilitySlots > form.minimumAvailabilitySlots`,
  `    form.minimumAvailabilitySlots < 0 ||\n    form.minimumWeekendAvailabilitySlots < 0 ||\n    form.minimumWeekendAvailabilitySlots > form.minimumAvailabilitySlots ||\n    form.minimumFinalsAvailabilitySlots < 0`,
);
replaceOnce(
  adminPagePath,
  `    minimumAvailabilitySlots: form.minimumAvailabilitySlots,\n    minimumWeekendAvailabilitySlots: form.minimumWeekendAvailabilitySlots,\n    slotDurationMinutes: form.slotDurationMinutes,`,
  `    minimumAvailabilitySlots: form.minimumAvailabilitySlots,\n    minimumWeekendAvailabilitySlots: form.minimumWeekendAvailabilitySlots,\n    minimumFinalsAvailabilitySlots: form.minimumFinalsAvailabilitySlots,\n    slotDurationMinutes: form.slotDurationMinutes,`,
);
replaceOnce(
  adminPagePath,
  `                  Le minimum de disponibilités s’applique uniquement aux poules.\n                  Les disponibilités de phase finale sont recueillies en plus.`,
  `                  Les minima des poules et de la phase finale sont configurables\n                  séparément.`,
);
replaceOnce(
  adminPagePath,
  `                  <label>\n                    Minimum week-end — poules\n                    <input\n                      required\n                      type="number"\n                      min="0"\n                      disabled={!editable || saving}\n                      value={form.minimumWeekendAvailabilitySlots}\n                      onChange={(event) =>\n                        setForm({\n                          ...form,\n                          minimumWeekendAvailabilitySlots: Number(\n                            event.target.value,\n                          ),\n                        })\n                      }\n                    />\n                  </label>`,
  `                  <label>\n                    Minimum week-end — poules\n                    <input\n                      required\n                      type="number"\n                      min="0"\n                      disabled={!editable || saving}\n                      value={form.minimumWeekendAvailabilitySlots}\n                      onChange={(event) =>\n                        setForm({\n                          ...form,\n                          minimumWeekendAvailabilitySlots: Number(\n                            event.target.value,\n                          ),\n                        })\n                      }\n                    />\n                  </label>\n                  <label>\n                    Minimum de créneaux — phase finale\n                    <input\n                      required\n                      type="number"\n                      min="0"\n                      disabled={!editable || saving}\n                      value={form.minimumFinalsAvailabilitySlots}\n                      onChange={(event) =>\n                        setForm({\n                          ...form,\n                          minimumFinalsAvailabilitySlots: Number(\n                            event.target.value,\n                          ),\n                        })\n                      }\n                    />\n                  </label>`,
);

const migration = String.raw`begin;

-- Rend le minimum de disponibilités de phase finale configurable par tournoi.
alter table public.tournaments
add column if not exists minimum_finals_availability_slots integer not null default 35;

alter table public.tournaments
drop constraint if exists tournaments_minimum_finals_availability_slots_check;

alter table public.tournaments
add constraint tournaments_minimum_finals_availability_slots_check
check (minimum_finals_availability_slots >= 0);

create or replace function public.tournament_team_finals_availability_is_valid(
  target_team_id uuid
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  target_team public.tournament_teams;
  target_tournament public.tournaments;
  selected_finals_count integer := 0;
begin
  select team.*
  into target_team
  from public.tournament_teams as team
  where team.id = target_team_id;

  if target_team.id is null
    or target_team.status not in ('pending', 'accepted') then
    return true;
  end if;

  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_team.tournament_id;

  if target_tournament.id is null
    or target_tournament.finals_starts_on is null
    or target_tournament.finals_ends_on is null then
    return true;
  end if;

  select count(*)::integer
  into selected_finals_count
  from public.tournament_team_availability_slots as availability
  join public.tournament_generated_slots(target_tournament.id) as generated
    on generated.play_date = availability.play_date
   and generated.starts_at = availability.starts_at
   and generated.ends_at = availability.ends_at
  where availability.team_id = target_team.id
    and availability.tournament_id = target_tournament.id
    and generated.phase = 'finals';

  return selected_finals_count >= target_tournament.minimum_finals_availability_slots;
end;
$$;

create or replace function public.admin_get_tournament_with_finals_minimum(
  target_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_payload jsonb;
  target_minimum integer;
begin
  base_payload := public.admin_get_tournament(target_id);

  select tournament.minimum_finals_availability_slots
  into target_minimum
  from public.tournaments as tournament
  where tournament.id = target_id;

  return base_payload || jsonb_build_object(
    'minimum_finals_availability_slots',
    coalesce(target_minimum, 35)
  );
end;
$$;

create or replace function public.admin_create_tournament_with_finals_minimum(
  payload jsonb
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_id uuid;
  target_minimum integer := coalesce(
    nullif(payload->>'minimum_finals_availability_slots', '')::integer,
    35
  );
begin
  if target_minimum < 0 then
    raise exception 'Tournament availability settings are invalid'
      using errcode = '22023';
  end if;

  target_id := public.admin_create_tournament(payload);

  update public.tournaments
  set
    minimum_finals_availability_slots = target_minimum,
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_id;

  return target_id;
end;
$$;

create or replace function public.admin_update_tournament_with_finals_minimum(
  target_id uuid,
  payload jsonb
)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_minimum integer := coalesce(
    nullif(payload->>'minimum_finals_availability_slots', '')::integer,
    35
  );
  previous_minimum integer;
begin
  if target_minimum < 0 then
    raise exception 'Tournament availability settings are invalid'
      using errcode = '22023';
  end if;

  select tournament.minimum_finals_availability_slots
  into previous_minimum
  from public.tournaments as tournament
  where tournament.id = target_id;

  perform public.admin_update_tournament(target_id, payload);

  update public.tournaments
  set
    minimum_finals_availability_slots = target_minimum,
    updated_by = auth.uid(),
    updated_at = now()
  where id = target_id;

  if previous_minimum is distinct from target_minimum then
    insert into public.tournament_audit_log (
      tournament_id,
      action,
      payload,
      created_by
    )
    values (
      target_id,
      'finals_availability_minimum_updated',
      jsonb_build_object(
        'before', previous_minimum,
        'after', target_minimum
      ),
      auth.uid()
    );
  end if;
end;
$$;

create or replace function public.get_public_tournament_availability_grid_with_finals_minimum(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_payload jsonb;
  target_minimum integer;
begin
  base_payload := public.get_public_tournament_availability_grid(target_tournament_id);
  if base_payload is null then
    return null;
  end if;

  select tournament.minimum_finals_availability_slots
  into target_minimum
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  return base_payload || jsonb_build_object(
    'minimum_finals',
    coalesce(target_minimum, 35)
  );
end;
$$;

create or replace function public.admin_get_tournament_dated_availability_with_finals_minimum(
  target_tournament_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  base_payload jsonb;
  target_minimum integer;
begin
  base_payload := public.admin_get_tournament_dated_availability(target_tournament_id);

  select tournament.minimum_finals_availability_slots
  into target_minimum
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  return base_payload || jsonb_build_object(
    'minimum_finals',
    coalesce(target_minimum, 35)
  );
end;
$$;

create or replace function public.generate_tournament_test_data(
  target_tournament_id uuid,
  target_teams_per_series integer default 8
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  target_tournament public.tournaments;
  result jsonb;
  target_batch_id uuid;
  available_finals_count integer := 0;
  selected_finals_count integer := 0;
  missing_finals_count integer := 0;
  test_team record;
begin
  select tournament.*
  into target_tournament
  from public.tournaments as tournament
  where tournament.id = target_tournament_id;

  if target_tournament.id is null then
    raise exception 'Tournament not found' using errcode = 'P0002';
  end if;

  if target_tournament.finals_starts_on is not null
    and target_tournament.finals_ends_on is not null then
    select count(*)::integer
    into available_finals_count
    from public.tournament_generated_slots(target_tournament.id) as generated
    where generated.phase = 'finals';

    if available_finals_count < target_tournament.minimum_finals_availability_slots then
      raise exception 'Tournament does not contain enough finals slots for test registrations'
        using errcode = 'P0001';
    end if;
  end if;

  result := public.generate_tournament_test_data_phase_aware_legacy(
    target_tournament_id,
    target_teams_per_series
  );

  target_batch_id := nullif(result->>'batch_id', '')::uuid;

  if target_batch_id is not null
    and target_tournament.finals_starts_on is not null
    and target_tournament.finals_ends_on is not null then
    for test_team in
      select link.team_id
      from public.tournament_test_data_teams as link
      where link.batch_id = target_batch_id
    loop
      select count(*)::integer
      into selected_finals_count
      from public.tournament_team_availability_slots as availability
      join public.tournament_generated_slots(target_tournament.id) as generated
        on generated.play_date = availability.play_date
       and generated.starts_at = availability.starts_at
       and generated.ends_at = availability.ends_at
      where availability.team_id = test_team.team_id
        and availability.tournament_id = target_tournament.id
        and generated.phase = 'finals';

      missing_finals_count := greatest(
        target_tournament.minimum_finals_availability_slots - selected_finals_count,
        0
      );

      if missing_finals_count > 0 then
        insert into public.tournament_team_availability_slots (
          team_id,
          tournament_id,
          play_date,
          starts_at,
          ends_at
        )
        select
          test_team.team_id,
          target_tournament.id,
          generated.play_date,
          generated.starts_at,
          generated.ends_at
        from public.tournament_generated_slots(target_tournament.id) as generated
        where generated.phase = 'finals'
          and not exists (
            select 1
            from public.tournament_team_availability_slots as selected
            where selected.team_id = test_team.team_id
              and selected.tournament_id = target_tournament.id
              and selected.play_date = generated.play_date
              and selected.starts_at = generated.starts_at
              and selected.ends_at = generated.ends_at
          )
        order by random()
        limit missing_finals_count;
      end if;

      perform public.assert_tournament_team_finals_availability(test_team.team_id);
    end loop;
  end if;

  return result || jsonb_build_object(
    'minimum_finals_slots',
    case
      when target_tournament.finals_starts_on is not null
        and target_tournament.finals_ends_on is not null
      then target_tournament.minimum_finals_availability_slots
      else 0
    end
  );
end;
$$;

revoke all on function public.admin_get_tournament_with_finals_minimum(uuid)
from public, anon, authenticated;
revoke all on function public.admin_create_tournament_with_finals_minimum(jsonb)
from public, anon, authenticated;
revoke all on function public.admin_update_tournament_with_finals_minimum(uuid, jsonb)
from public, anon, authenticated;
revoke all on function public.admin_get_tournament_dated_availability_with_finals_minimum(uuid)
from public, anon, authenticated;
revoke all on function public.get_public_tournament_availability_grid_with_finals_minimum(uuid)
from public, anon, authenticated;

 grant execute on function public.admin_get_tournament_with_finals_minimum(uuid)
to authenticated;
grant execute on function public.admin_create_tournament_with_finals_minimum(jsonb)
to authenticated;
grant execute on function public.admin_update_tournament_with_finals_minimum(uuid, jsonb)
to authenticated;
grant execute on function public.admin_get_tournament_dated_availability_with_finals_minimum(uuid)
to authenticated;
grant execute on function public.get_public_tournament_availability_grid_with_finals_minimum(uuid)
to anon, authenticated;

commit;
`;
write(
  "supabase/migrations/20260814161500_configure_tournament_finals_availability_minimum.sql",
  migration,
);

const testPath = "tests/tournamentFinalsAvailabilityMinimum.test.mjs";
write(
  testPath,
  `import assert from "node:assert/strict";\nimport { readFile } from "node:fs/promises";\nimport test from "node:test";\n\nconst read = (path) => readFile(new URL(path, import.meta.url), "utf8");\n\nconst migrationPath =\n  "../supabase/migrations/20260814161500_configure_tournament_finals_availability_minimum.sql";\n\ntest("le minimum de phase finale est configurable par tournoi", async () => {\n  const [migration, adminPage, grid] = await Promise.all([\n    read(migrationPath),\n    read("../src/features/admin/tournaments/pages/AdminTournamentsPage.tsx"),\n    read("../src/features/tournaments/components/TournamentAvailabilityGrid.tsx"),\n  ]);\n\n  assert.match(\n    migration,\n    /minimum_finals_availability_slots integer not null default 35/,\n  );\n  assert.match(\n    migration,\n    /selected_finals_count >= target_tournament\\.minimum_finals_availability_slots/,\n  );\n  assert.match(migration, /admin_create_tournament_with_finals_minimum/);\n  assert.match(migration, /admin_update_tournament_with_finals_minimum/);\n  assert.match(adminPage, /minimumFinalsAvailabilitySlots: 35/);\n  assert.match(adminPage, /Minimum de créneaux — phase finale/);\n  assert.match(grid, /tournament\\.minimumFinalsAvailabilitySlots/);\n});\n\ntest("le générateur de test respecte le minimum final configuré", async () => {\n  const migration = await read(migrationPath);\n\n  assert.match(\n    migration,\n    /available_finals_count < target_tournament\\.minimum_finals_availability_slots/,\n  );\n  assert.match(\n    migration,\n    /target_tournament\\.minimum_finals_availability_slots - selected_finals_count/,\n  );\n  assert.match(migration, /'minimum_finals_slots'/);\n});\n\ntest("utilisateur et admin partagent les contrôles de semaine", async () => {\n  const [grid, registrationForm, adminTeamsPage] = await Promise.all([\n    read("../src/features/tournaments/components/TournamentAvailabilityGrid.tsx"),\n    read("../src/features/tournaments/components/TournamentRegistrationForm.tsx"),\n    read("../src/features/admin/tournaments/pages/AdminTournamentTeamsPage.tsx"),\n  ]);\n\n  assert.match(grid, /Tout cocher la semaine/);\n  assert.match(grid, /Tout décocher la semaine/);\n  assert.match(grid, /Dupliquer cette semaine → suivante/);\n  assert.match(registrationForm, /TournamentAvailabilityGrid/);\n  assert.match(adminTeamsPage, /TournamentAvailabilityGrid/);\n});\n`,
);

// Remove the temporary patch mechanism from the resulting feature commit.
if (fs.existsSync(".github/workflows/tmp-tournament-availability.yml")) {
  fs.unlinkSync(".github/workflows/tmp-tournament-availability.yml");
}
fs.unlinkSync("scripts/tmp-patch-tournament-availability.mjs");
