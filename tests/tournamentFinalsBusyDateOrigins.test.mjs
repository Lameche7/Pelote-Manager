import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("les conflits des phases finales distinguent joueur et partenaire", async () => {
  const [migration, service, editor] = await Promise.all([
    read(
      "../supabase/migrations/20261113150000_finals_busy_date_player_origins.sql",
    ),
    read("../src/features/tournaments/services/tournamentService.ts"),
    read(
      "../src/features/tournaments/components/TournamentFinalsAvailabilityEditor.tsx",
    ),
  ]);
  assert.match(migration, /tournament_team_busy_date_origins/);
  assert.match(migration, /tournament_profile_is_linked_to_team/);
  assert.match(
    migration,
    /blocked_by_self boolean, blocked_by_partner boolean/,
  );
  assert.match(migration, /bool_or\(conflicts\.is_self\)/);
  assert.match(migration, /bool_or\(not conflicts\.is_self\)/);
  assert.match(
    migration,
    /revoke all on function public\.tournament_team_busy_date_origins/,
  );
  assert.match(service, /getTeamBusyDates/);
  assert.match(service, /getTeamBusyDateOrigins/);
  assert.match(editor, /Vous avez déjà une partie programmée/);
  assert.match(editor, /Votre partenaire a déjà une partie programmée/);
  assert.match(
    editor,
    /Vous et votre partenaire avez chacun une partie programmée/,
  );
  assert.match(editor, /const conflicts = new Set\(results\.map/);
  assert.match(editor, /busyDates=\{\[\.\.\.blockedDays\]\}/);
});
