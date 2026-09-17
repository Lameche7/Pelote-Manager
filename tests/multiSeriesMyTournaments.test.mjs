import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260917090000_fix_multi_series_my_tournaments.sql",
  import.meta.url,
);
const serviceUrl = new URL(
  "../src/features/user-space/tournaments/services/myTournamentsService.ts",
  import.meta.url,
);

test("Mes tournois conserve plusieurs participations du même tournoi", async () => {
  const [migration, service] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(serviceUrl, "utf8"),
  ]);

  assert.match(migration, /select distinct on \(team\.tournament_id\)/);
  assert.match(
    migration,
    /replace\([\s\S]*'select distinct on \(team\.tournament_id\)'[\s\S]*'select'/,
  );
  assert.match(service, /qualificationByTeam/);
  assert.match(service, /tournament\.id}:\$\{tournament\.team\.id/);
});
