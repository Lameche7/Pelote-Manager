import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261120224600_guard_final_auto_slot_node_conflicts.sql",
    import.meta.url,
  ),
  "utf8",
);

test("automatic finals exclude other provisional nodes before assignment", () => {
  const guards = [
    "from public.tournament_final_planning_nodes reserved_node",
    "reserved_node.tournament_id=target_tournament_id",
    "reserved_node.resource_id=selected.resource_id",
    "reserved_node.play_date=slot.play_date",
    "reserved_node.starts_at<slot.ends_at",
    "reserved_node.ends_at>slot.starts_at",
    "reserved_node.series_id=entry.series_id",
    "reserved_node.round_number=entry.final_round_number",
    "reserved_node.display_order=entry.display_order",
  ];
  for (const guard of guards) {
    assert.ok(migration.includes(guard), guard);
  }
});

test("availability, occupations and confirmed admin slots stay protected", () => {
  const guards = [
    "a.team_id=entry.team_a_id",
    "b.team_id=entry.team_b_id",
    "from public.calendar_occupations occ",
    "tournament_final_plan_is_confirmed_manual",
    "source='generated',updated_at=now()",
    "revoke all on function public.auto_assign_ready_tournament_final_slots",
  ];
  for (const guard of guards) {
    assert.ok(migration.includes(guard), guard);
  }
});
