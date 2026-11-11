import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20261111150000_allow_unlicensed_club_referees.sql",
    import.meta.url,
  ),
  "utf8",
);
for (const name of ["volunteer_for_refereeing", "admin_set_referee"]) {
  test(name + " accepts club members without licence, not outsiders", () => {
    const body = sql
      .split("create or replace function public." + name + "(")[1]
      .split("end $$;")[0];
    assert.match(body, /public\.club_memberships/);
    assert.match(body, /public\.club_members/);
    assert.match(body, /m\.is_active/);
    assert.doesNotMatch(body, /is_active_licensee_for_club/);
    assert.match(body, /refereeing_current_match_slot/);
    assert.match(body, /referee_slot_assignments/);
  });
}
test("admin permission and single slot assignment remain enforced", () => {
  assert.match(sql, /has_club_permission/);
  assert.match(sql, /on conflict \(resource_id,starts_at\)/);
  assert.match(sql, /unique_violation/);
});
