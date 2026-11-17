import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const page = read(
  "../src/features/user-space/tournaments/pages/MyTournamentsPage.tsx",
);
const calendar = read(
  "../src/features/reservations/services/reservationCalendarService.ts",
);
const migration = read(
  "../supabase/migrations/20261117094500_public_full_finals_calendar_projection.sql",
);

test("Mes tournois can collapse and lazily load editable finals availabilities", () => {
  assert.match(page, /Afficher \/ masquer mes disponibilités — phase finale/);
  assert.match(page, /onToggle=.*setExpanded/);
  assert.match(page, /tournamentService\.getMyFinalsAvailabilities/);
  assert.match(page, /TournamentFinalsAvailabilityEditor/);
  assert.match(page, /onSaved=\{reload\}/);
});

test("historical projection data may exist but the player calendar never blocks a speculative slot", () => {
  assert.match(migration, /tournament_final_planning_nodes/);
  assert.match(migration, /node\.round_number/);
  assert.match(migration, /adversaires à déterminer \(prévisionnel\)/);
  assert.doesNotMatch(
    calendar,
    /list_public_tournament_final_calendar_projections/,
  );
  assert.doesNotMatch(calendar, /tournament_finals_projection/);
  assert.doesNotMatch(migration, /insert into public\.tournament_matches/);
  assert.doesNotMatch(migration, /update public\.reservations/);
});
