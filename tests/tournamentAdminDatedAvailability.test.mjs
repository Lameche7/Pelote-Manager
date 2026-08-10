import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260810170000_admin_tournament_dated_availability.sql";

test("l'admin lit les compteurs depuis les créneaux datés du tournoi", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /admin_get_tournament_dated_availability/);
  assert.match(migration, /public\.tournament_team_availability_slots/);
  assert.match(migration, /public\.tournament_play_windows/);
  assert.match(migration, /minimum_availability_slots/);
  assert.match(migration, /minimum_weekend_availability_slots/);
  assert.match(migration, /available_slot_count/);
  assert.match(migration, /weekend_slot_count/);
  assert.match(migration, /has_club_permission/);
  assert.match(
    migration,
    /grant execute on function public\.admin_get_tournament_dated_availability\(uuid\)[\s\S]*to authenticated/,
  );
});

test("le service et l'écran admin n'utilisent plus le nombre de règles historiques comme compteur", async () => {
  const [service, page] = await Promise.all([
    read(
      "../src/features/admin/tournaments/services/adminTournamentTeamService.ts",
    ),
    read(
      "../src/features/admin/tournaments/pages/AdminTournamentTeamsPage.tsx",
    ),
  ]);

  assert.match(service, /admin_get_tournament_dated_availability/);
  assert.match(service, /availabilitySlotCount/);
  assert.match(service, /weekendAvailabilitySlotCount/);
  assert.match(page, /Disponibilités datées/);
  assert.match(page, /team\.availabilitySlotCount/);
  assert.match(page, /team\.weekendAvailabilitySlotCount/);
  assert.doesNotMatch(page, /<dd>\{team\.availabilityRules\.length\}<\/dd>/);
});
