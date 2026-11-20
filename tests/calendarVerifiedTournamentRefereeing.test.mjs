import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20261120094500_calendar_verified_tournament_refereeing.sql",
    import.meta.url,
  ),
  "utf8",
);

test("calendar enables referee volunteering for a verified participant in the precise tournament", () => {
  assert.match(sql, /m\.kind='tournament' and exists/);
  assert.match(sql, /tm\.id=m\.match_id/);
  assert.match(
    sql,
    /public\.is_verified_tournament_player\(auth\.uid\(\),tm\.tournament_id\)/,
  );
  assert.match(sql, /join resource r on r\.club_id=t\.club_id/);
  assert.match(sql, /t\.refereeing_enabled/);
  assert.match(
    sql,
    /not exists\(\s*select 1 from public\.referee_slot_assignments/,
  );
});

test("calendar keeps the existing club and championship constraints", () => {
  assert.match(sql, /join public\.championship_team_players/);
  assert.match(sql, /join public\.club_memberships membership/);
  assert.match(sql, /join public\.club_members member/);
  assert.match(sql, /m\.kind='championship'/);
  assert.match(sql, /'canVolunteerForRefereeing',e\.can_volunteer/);
  assert.match(
    sql,
    /grant execute on function public\.resolve_calendar_player_actions/,
  );
});
