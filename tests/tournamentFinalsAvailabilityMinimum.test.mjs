import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260814161500_configure_tournament_finals_availability_minimum.sql";

test("le minimum de phase finale est configurable par tournoi", async () => {
  const [migration, adminPage, grid] = await Promise.all([
    read(migrationPath),
    read("../src/features/admin/tournaments/pages/AdminTournamentsPage.tsx"),
    read("../src/features/tournaments/components/TournamentAvailabilityGrid.tsx"),
  ]);

  assert.match(
    migration,
    /minimum_finals_availability_slots integer not null default 35/,
  );
  assert.match(
    migration,
    /selected_finals_count >= target_tournament\.minimum_finals_availability_slots/,
  );
  assert.match(migration, /admin_create_tournament_with_finals_minimum/);
  assert.match(migration, /admin_update_tournament_with_finals_minimum/);
  assert.match(adminPage, /minimumFinalsAvailabilitySlots: 35/);
  assert.match(adminPage, /Minimum de créneaux — phase finale/);
  assert.match(grid, /tournament\.minimumFinalsAvailabilitySlots/);
});

test("le générateur de test respecte le minimum final configuré", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /available_finals_count < target_tournament\.minimum_finals_availability_slots/,
  );
  assert.match(
    migration,
    /target_tournament\.minimum_finals_availability_slots - selected_finals_count/,
  );
  assert.match(migration, /'minimum_finals_slots'/);
});

test("utilisateur et admin partagent les contrôles de semaine", async () => {
  const [grid, registrationForm, adminTeamsPage] = await Promise.all([
    read("../src/features/tournaments/components/TournamentAvailabilityGrid.tsx"),
    read("../src/features/tournaments/components/TournamentRegistrationForm.tsx"),
    read("../src/features/admin/tournaments/pages/AdminTournamentTeamsPage.tsx"),
  ]);

  assert.match(grid, /Tout cocher la semaine/);
  assert.match(grid, /Tout décocher la semaine/);
  assert.match(grid, /Dupliquer cette semaine → suivante/);
  assert.match(registrationForm, /TournamentAvailabilityGrid/);
  assert.match(adminTeamsPage, /TournamentAvailabilityGrid/);
});
