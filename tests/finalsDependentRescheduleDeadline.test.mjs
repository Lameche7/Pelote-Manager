import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261116133000_reschedule_before_dependent_finals.sql",
    import.meta.url,
  ),
  "utf8",
);

test("final reschedule cutoff follows the actual dependency graph", () => {
  assert.match(migration, /tournament_final_node_depends_on/);
  assert.match(migration, /node\.round_number > target_match\.final_round_number/);
  assert.match(migration, /node\.series_id = target_match\.series_id/);
  assert.match(migration, /min\(node\.play_date - 1\)/);
  assert.match(migration, /least\(general_deadline, dependent_deadline\)/);
});

test("the option search and apply both check the new deadline", () => {
  assert.match(migration, /get_my_tournament_reschedule_options\(uuid,uuid\)/);
  assert.match(migration, /admin_apply_tournament_reschedule_request\(uuid\)/);
  assert.match(migration, /tournament_match_reschedule_latest_play_date\(target_match\.id\)/);
  assert.match(migration, /tournament_match_reschedule_latest_play_date\(swap_match\.id\)/);
  assert.match(migration, /tournament_match_reschedule_latest_play_date\(target_match_id\)/);
  assert.match(migration, /An old apply deadline call still remains/);
});

test("existing invalid requests become stale without deleting their history", () => {
  assert.match(migration, /req\.status in \('pending', 'approved'\)/);
  assert.match(migration, /mark_tournament_reschedule_stale/);
  assert.match(migration, /next_round_precedes_proposed_reschedule/);
  assert.doesNotMatch(migration, /delete from public\.tournament_reschedule_requests/);
  assert.match(migration, /commit;\s*$/);
});
