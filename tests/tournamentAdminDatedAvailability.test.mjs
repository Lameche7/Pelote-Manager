import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260811070000_tournament_admin_phases_and_live_configuration.sql";

test("l'admin lit les disponibilités datées séparées entre poules et phase finale", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /admin_get_tournament_dated_availability/);
  assert.match(migration, /public\.tournament_team_availability_slots/);
  assert.match(migration, /public\.tournament_generated_slots/);
  assert.match(migration, /minimum_availability_slots/);
  assert.match(migration, /minimum_weekend_availability_slots/);
  assert.match(migration, /available_pool_slot_count/);
  assert.match(migration, /available_finals_slot_count/);
  assert.match(migration, /pool_slot_count/);
  assert.match(migration, /finals_slot_count/);
  assert.match(migration, /has_club_permission/);
  assert.match(
    migration,
    /grant execute on function public\.admin_get_tournament_dated_availability\(uuid\)[\s\S]*to authenticated/,
  );
});

test("le service et le tableau admin affichent les compteurs de chaque phase", async () => {
  const [service, page] = await Promise.all([
    read(
      "../src/features/admin/tournaments/services/adminTournamentTeamService.ts",
    ),
    read(
      "../src/features/admin/tournaments/pages/AdminTournamentTeamsPage.tsx",
    ),
  ]);

  assert.match(service, /admin_get_tournament_dated_availability/);
  assert.match(service, /poolAvailabilitySlotCount/);
  assert.match(service, /finalsAvailabilitySlotCount/);
  assert.match(page, /Tableau des équipes/);
  assert.match(page, /Poules \$\{team\.poolAvailabilitySlotCount\}/);
  assert.match(page, /Finale \$\{team\.finalsAvailabilitySlotCount\}/);
  assert.doesNotMatch(page, /<dd>\{team\.availabilityRules\.length\}<\/dd>/);
});
