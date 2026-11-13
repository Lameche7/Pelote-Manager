import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(file, import.meta.url), "utf8");

test("formulaires de finales par série", async () => {
  const [page, editor, service, migration] = await Promise.all([
    read("../src/features/tournaments/pages/TournamentDetailPage.tsx"),
    read(
      "../src/features/tournaments/components/TournamentFinalsAvailabilityEditor.tsx",
    ),
    read("../src/features/tournaments/services/tournamentService.ts"),
    read(
      "../supabase/migrations/20261113170000_multi_series_finals_availability.sql",
    ),
  ]);
  assert.match(page, /getMyFinalsAvailabilities\(tournamentId\)/);
  assert.match(page, /linkedFinals\.map\(\(team\) =>/);
  assert.match(page, /key=\{team\.teamId\}/);
  assert.match(editor, /registration\.seriesName/);
  assert.match(editor, /registration\.teamLabel/);
  assert.match(
    editor,
    /getTeamBusyDates\(tournament\.id, registration\.teamId\)/,
  );
  assert.match(
    editor,
    /getTeamBusyDateOrigins\(tournament\.id, registration\.teamId\)/,
  );
  assert.match(editor, /registration\.teamId,\s*selected,/);
  assert.match(service, /get_my_tournament_finals_availabilities/);
  assert.match(service, /update_my_tournament_team_finals_availability/);
  assert.match(migration, /get_my_tournament_finals_availabilities/);
  assert.match(migration, /jsonb_agg\(/);
  assert.match(migration, /team\.id = target_team_id/);
  assert.match(
    migration,
    /public\.tournament_team_busy_dates_for_team\(target_tournament_id, linked_team_id\)/,
  );
  assert.match(
    migration,
    /public\.tournament_profile_is_linked_to_team\(team\.id, auth\.uid\(\)\)/,
  );
  assert.match(
    migration,
    /public\.assert_tournament_team_finals_availability\(linked_team_id\)/,
  );
  assert.match(
    migration,
    /revoke all on function public\.update_my_tournament_team_finals_availability/,
  );
});
