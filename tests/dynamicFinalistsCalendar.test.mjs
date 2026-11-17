import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read(
  "../supabase/migrations/20261117095500_public_finals_calendar_projection_bracket_keys.sql",
);
const calendar = read(
  "../src/features/reservations/services/reservationCalendarService.ts",
);
const results = read(
  "../src/features/tournaments/services/tournamentResultsService.ts",
);

test("public calendar projections identify their actual bracket positions", () => {
  assert.match(migration, /list_public_tournament_final_calendar_projections_v2/);
  assert.match(migration, /node\.tournament_id, node\.series_id, node\.round_number, node\.display_order/);
  assert.match(migration, /event\.publication_status = 'published'/);
  assert.doesNotMatch(migration, /update public\.tournament_matches/);
});

test("calendar uses the same advancing participant projection as Mes tournois", () => {
  assert.match(results, /buildFinalBracketProjectedMatches/);
  assert.match(calendar, /tournamentResultsService\.get\(tournamentId\)/);
  assert.match(calendar, /match\.roundNumber === projection\.round_number/);
  assert.match(calendar, /match\.displayOrder === projection\.display_order/);
  assert.match(calendar, /projectedMatch\.teamALabel/);
  assert.match(calendar, /projectedMatch\.teamBLabel/);
  assert.match(calendar, /adversaires à déterminer \(prévisionnel\)/);
  assert.match(calendar, /slot\.status === "occupied"/);
});
