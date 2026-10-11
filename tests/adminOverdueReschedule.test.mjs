import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const file = "20261011170000_admin_reschedule_past_unplayed_matches.sql";
const sql = fs.readFileSync(`supabase/migrations/${file}`, "utf8");

test("les parties sans résultat validé restent reportables", () => {
  assert.match(sql, /result\.status = 'validated'/);
  assert.match(sql, /candidate\.absolute_starts_at > now\(\)/);
});

test("les anciens créneaux ne bloquent plus un report admin", () => {
  assert.match(sql, /Une partie non jouée reste reportable/);
  assert.match(sql, /target_play_date,/);
  assert.match(sql, /target_starts_at,/);
});
