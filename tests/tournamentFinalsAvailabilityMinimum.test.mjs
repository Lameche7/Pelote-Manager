import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260811094500_add_finals_availability_minimum.sql";

test("la phase finale exige 35 créneaux dès qu'elle est configurée", async () => {
  const [migration, rules] = await Promise.all([
    read(migrationPath),
    read("../src/features/tournaments/domain/tournamentAvailabilityRules.ts"),
  ]);

  assert.match(rules, /TOURNAMENT_FINALS_MINIMUM_AVAILABILITY_SLOTS = 35/);
  assert.match(migration, /selected_finals_count >= 35/);
  assert.match(
    migration,
    /Tournament finals availability minimum not reached/,
  );
  assert.match(migration, /deferrable initially deferred/);
});

test("le générateur complète les équipes fictives jusqu'au minimum final", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /generate_tournament_test_data_phase_aware_legacy/,
  );
  assert.match(migration, /available_finals_count < 35/);
  assert.match(
    migration,
    /missing_finals_count := greatest\(35 - selected_finals_count, 0\)/,
  );
  assert.match(migration, /minimum_finals_slots/);
});

test("le formulaire et la grille exposent le minimum de 35 créneaux finale", async () => {
  const [form, grid] = await Promise.all([
    read(
      "../src/features/tournaments/components/TournamentRegistrationForm.tsx",
    ),
    read(
      "../src/features/tournaments/components/TournamentAvailabilityGrid.tsx",
    ),
  ]);

  assert.match(form, /TOURNAMENT_FINALS_MINIMUM_AVAILABILITY_SLOTS/);
  assert.match(form, /finalsMinimumReached/);
  assert.match(form, /phase finale/);
  assert.match(grid, /TOURNAMENT_FINALS_MINIMUM_AVAILABILITY_SLOTS/);
  assert.match(grid, /Minimum phase finale/);
});
