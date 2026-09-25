import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260925130000_show_championship_players_in_reservation_calendar.sql",
    import.meta.url,
  ),
  "utf8",
);

test("le calendrier des réservations affiche les joueurs des deux équipes de championnat", () => {
  assert.match(migration, /championship_team_players/);
  assert.match(migration, /championship_players/);
  assert.match(migration, /player\.last_name/);
  assert.match(migration, /player\.first_name/);
  assert.match(migration, /string_agg/);
  assert.match(migration, /team_player\.team_id = team1\.id/);
  assert.match(migration, /team_player\.team_id = team2\.id/);
  assert.match(migration, /concat\('vs '/);
});
