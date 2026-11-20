import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL("../supabase/migrations/20261120224600_guard_final_auto_slot_node_conflicts.sql", import.meta.url),
  "utf8",
);

test("automatic finals exclude other provisional planning nodes before assignment", () => {
  assert.match(migration, /from public\.tournament_final_planning_nodes reserved_node/);
  assert.match(migration, /reserved_node\.tournament_id=target_tournament_id/);
  assert.match(migration, /reserved_node\.resource_id=selected\.resource_id/);
  assert.match(migration, /reserved_node\.play_date=slot\.play_date/);
  assert.match(migration, /reserved_node\.starts_at<slot\.ends_at/);
  assert.match(migration, /reserved_node\.ends_at>slot\.starts_at/);
  assert.match(migration, /reserved_node\.series_id=entry\.series_id/);
  assert.match(migration, /reserved_node\.round_number=entry\.final_round_number/);
  assert.match(migration, /reserved_node\.display_order=entry\.display_order/);
});

test("availability, real court occupations and explicit admin slots stay protected", () => {
  assert.match(migration, /a\.team_id=entry\.team_a_id/);
  assert.match(migration, /b\.team_id=entry\.team_b_id/);
  assert.match(migration, /from public\.calendar_occupations occ/);
  assert.match(migration, /tournament_final_plan_is_confirmed_manual/);
  assert.match(migration, /source='generated',updated_at=now\(\)/);
  assert.match(migration, /revoke all on function public\.auto_assign_ready_tournament_final_slots/);
});
