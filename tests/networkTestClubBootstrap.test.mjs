import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  "supabase/migrations/20261012160000_bootstrap_pilotoki_test_club.sql",
  "utf8",
);

test("the first test tenant is distinct from Lourdes", () => {
  assert.match(sql, /'club-test-pilotoki'/);
  assert.match(sql, /'Club Test Pilotoki'/);
  assert.match(sql, /role\.club_id=test_club_id/);
  assert.doesNotMatch(sql, /update public\.clubs set/i);
});

test("administrator assignment requires one verified matching profile", () => {
  assert.match(sql, /profile_count <> 1/);
  assert.match(sql, /club_id<>test_club_id/);
  assert.match(sql, /lower\(btrim\(email\)\)/);
  assert.match(sql, /insert into public\.club_memberships/);
});
