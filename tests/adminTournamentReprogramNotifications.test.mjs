import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = new URL(
  "../supabase/migrations/20261104090000_notify_admin_tournament_reprogram.sql",
  import.meta.url,
);

test("reprogrammation admin : notification ciblée après validation", async () => {
  const sql = await readFile(migration, "utf8");
  assert.match(sql, /after insert on public\.tournament_audit_log/);
  assert.match(sql, /new\.action = 'match_reprogrammed'/);
  assert.match(
    sql,
    /tournament_profile_is_linked_to_team\(target_match\.team_a_id/,
  );
  assert.match(
    sql,
    /tournament_profile_is_linked_to_team\(target_match\.team_b_id/,
  );
  assert.match(sql, /referee_slot_assignments/);
  assert.match(sql, /select distinct profile\.id/);
  assert.match(sql, /communication_deliveries/);
  assert.match(sql, /status = 'published', published_at = now\(\)/);
  assert.match(sql, /recipient_count/);
  assert.match(sql, /audit_id uuid primary key/);
  assert.doesNotMatch(sql, /insert into public\.tournament_match_planning/);
});
