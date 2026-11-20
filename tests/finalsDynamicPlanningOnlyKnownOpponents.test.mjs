import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const migration = read(
  "../supabase/migrations/20261120235000_real_final_fixtures_only_planning.sql",
);
const planning = read(
  "../src/features/admin/tournaments/components/AdminTournamentFinalFullPlanning.tsx",
);
const weekly = read(
  "../src/features/admin/tournaments/components/AdminTournamentFinalWeeklyOverview.tsx",
);

test("the migration clears only unresolved, non-final slot allocations", () => {
  for (const fragment of [
    "update public.tournament_final_planning_nodes node",
    "node.round <> 'final'",
    "not exists (",
    "match.phase='finals'",
    "match.team_a_id is not null",
    "match.team_b_id is not null",
  ]) {
    assert.ok(migration.includes(fragment), fragment);
  }
  assert.ok(!migration.includes("delete from public.tournament_matches"));
});

test("the database rejects assignments for unknown semifinal or eighth opponents", () => {
  for (const fragment of [
    "guard_unresolved_tournament_final_slot",
    "new.resource_id is null or new.round='final'",
    "match.final_round_number=new.round_number",
    "match.display_order=new.display_order",
    "raise exception",
    "create trigger guard_unresolved_tournament_final_slot",
  ]) {
    assert.ok(migration.includes(fragment), fragment);
  }
});

test("the automatic and manual calendars only place complete actual matches", () => {
  for (const fragment of [
    "const realMatchNodes = useMemo(",
    "row?.actualMatchId && row.teamAId && row.teamBId",
    "const quickQueue = realMatchNodes.filter(",
    "nodes: realMatchNodes,",
    "realNodeIds.has(rowNodeId(row))",
    "const theoreticalPositionsCount = nodes.length - realMatchNodes.length",
    "Recalculer les rencontres connues",
  ]) {
    assert.ok(planning.includes(fragment), fragment);
  }
});

test("published matches and fixed final-day schedules remain protected", () => {
  for (const fragment of [
    "const reservedFinalSlots = persistedAssignments",
    "row.published ||",
    "row.resultStatus === \"validated\"",
    "...reservedFinalSlots,",
  ]) {
    assert.ok(planning.includes(fragment), fragment);
  }
  assert.ok(weekly.includes("finalDayReserved"));
  assert.ok(weekly.includes("Finale · horaire fixé"));
});
