import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("team administration uses explicit club RPCs when scoped", async () => {
  const service = await read(
    "../src/features/admin/tournaments/services/adminTournamentTeamService.ts",
  );
  for (const rpc of [
    "admin_list_tournament_teams_v3",
    "admin_get_tournament_dated_availability_with_finals_minimum",
    "admin_search_tournament_members",
    "admin_get_tournament_team_dated_availability",
    "admin_save_tournament_team_v5",
    "admin_set_tournament_team_status_v2",
    "admin_delete_tournament_team",
  ]) {
    assert.ok(service.includes('"' + rpc + '_for_club"'));
    assert.ok(service.includes('"' + rpc + '"'));
  }
  assert.match(service, /target_club_id: clubId/);
  assert.match(service, /if \(clubId\) \{\s*throw new Error\(/);
});

test("scoped teams page disables legacy import and replacement", async () => {
  const page = await read(
    "../src/features/admin/tournaments/pages/AdminTournamentTeamsPage.tsx",
  );
  const fields = await read(
    "../src/features/admin/tournaments/components/AdminTournamentPlayerFields.tsx",
  );
  assert.match(page, /createPlatformTournamentAdminService\(scopedClubId\)/);
  assert.match(page, /data && !scopedClubId &&/);
  assert.match(page, /!scopedClubId && data/);
  assert.match(page, /scopedClubId=\{scopedClubId\}/);
  assert.match(
    fields,
    /searchMembers\(tournamentId, query, teamId, scopedClubId\)/,
  );
});
