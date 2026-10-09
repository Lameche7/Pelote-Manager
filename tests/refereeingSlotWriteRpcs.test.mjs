import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";
const sql = readFileSync(
  new URL(
    "../supabase/migrations/20261008195500_refereeing_slot_write_rpcs.sql",
    import.meta.url,
  ),
  "utf8",
);
for (const name of [
  "volunteer_for_refereeing",
  "withdraw_from_refereeing",
  "admin_set_referee",
]) {
  test(name + " resolves current slot", () => {
    const fn = sql
      .split("create or replace function public." + name + "(")[1]
      .split("end $$;")[0];
    assert.match(
      fn,
      /refereeing_current_match_slot\(target_source_type,target_match_id\)/,
    );
    assert.match(fn, /referee_slot_assignments/);
    assert.doesNotMatch(
      fn,
      /(insert into|delete from|update) public\.referee_assignments/i,
    );
  });
}
test("membership and club access remain verified", () => {
  assert.match(sql, /is_active_licensee_for_club/);
  assert.match(sql, /has_club_permission/);
  assert.match(sql, /s\.club_id<>current_club/);
});
