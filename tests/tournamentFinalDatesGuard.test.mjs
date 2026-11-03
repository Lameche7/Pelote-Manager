import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("modifier les dates finales ne revalide pas les anciennes disponibilités", async () => {
  const [migration, page] = await Promise.all([
    read(
      "../supabase/migrations/20261103194500_allow_existing_final_availability_on_date_update.sql",
    ),
    read(
      "../src/features/admin/tournaments/pages/AdminTournamentQualificationPage.tsx",
    ),
  ]);

  assert.match(migration, /enforce_tournament_finals_availability_for_teams/);
  assert.match(migration, /new\.finals_starts_on is distinct from old\.finals_starts_on/);
  assert.match(migration, /minimum_finals_availability_slots/);
  assert.match(migration, /perform public\.assert_tournament_team_finals_availability/);
  assert.match(page, /disponibilités enregistrées restent conservées/);
});
