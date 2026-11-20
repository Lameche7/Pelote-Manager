import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL("../supabase/migrations/20261120091500_verified_tournament_participant_refereeing.sql", import.meta.url),
  "utf8",
);

test("a verified account must actually participate in an accepted team of the specified tournament", () => {
  assert.match(sql, /ident\.profile_id=actor/);
  assert.match(sql, /ident\.status='verified'/);
  assert.match(sql, /tt\.status='accepted'/);
  assert.match(sql, /tp\.tournament_id=target_tournament_id/);
  assert.match(sql, /tt\.tournament_id=tp\.tournament_id/);
  assert.match(sql, /revoke all on function public\.is_verified_tournament_player\(uuid,uuid\) from public,anon,authenticated/);
});

test("the arbitration workspace includes verified tournament participants, not championship outsiders", () => {
  assert.match(sql, /public\.is_verified_tournament_player\(auth\.uid\(\),t\.id\)/);
  assert.match(sql, /join my_clubs mc on mc\.club_id=rr\.club_id/);
  assert.match(sql, /join public\.championship_club_links cl/);
});

test("a volunteer can arbitrate a verified tournament but not a different tournament or championship", () => {
  assert.match(sql, /target_source_type = 'tournament' and exists \(/);
  assert.match(sql, /tm\.id = target_match_id/);
  assert.match(sql, /public\.is_verified_tournament_player\(actor,tm\.tournament_id\)/);
  assert.match(sql, /public\.refereeing_current_match_slot/);
  assert.match(sql, /public\.club_memberships/);
  assert.match(sql, /public\.club_members/);
  assert.doesNotMatch(sql, /public\.is_active_licensee_for_club/);
});

test("admin assignment keeps club permission and tournament-only eligibility", () => {
  assert.match(sql, /public\.has_club_permission\(current_club,'championships\.manage'\)/);
  assert.match(sql, /s\.club_id <> current_club/);
  assert.match(sql, /public\.is_verified_tournament_player\(target_profile_id,tm\.tournament_id\)/);
  assert.match(sql, /on conflict \(resource_id,starts_at\)/);
});
