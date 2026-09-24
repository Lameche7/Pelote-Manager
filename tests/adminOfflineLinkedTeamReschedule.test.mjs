import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/migrations/20260924110000_allow_admin_offline_decision_for_linked_teams.sql",
  "utf8",
);
const page = fs.readFileSync(
  "src/features/admin/tournaments/pages/AdminTournamentReschedulePage.tsx",
  "utf8",
);

test("admin can record an offline answer even for a linked team", () => {
  assert.match(migration, /admin_record_tournament_reschedule_offline_decision/);
  assert.match(migration, /tournament_team_app_actor_count/);
  assert.match(migration, /replace/);
  assert.match(page, /pendingApprovals/);
  assert.match(page, /même si un compte est relié/);
  assert.doesNotMatch(
    page,
    /approval\.decision === "pending" && approval\.appActorCount === 0/,
  );
});
