import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261119221000_unblock_provisional_final_manual_plans.sql",
    import.meta.url,
  ),
  "utf8",
);

test("bulk preliminary slots are not treated as confirmed manual bookings", () => {
  assert.match(migration, /final_stage_exceptional_manual_slot/);
  assert.match(migration, /match_reprogrammed/);
  assert.doesNotMatch(migration, /final_stage_full_planning_saved/);
  assert.match(
    migration,
    /existing_plan\.source='manual'\s+and \(entry\.final_round='final'/,
  );
  assert.match(
    migration,
    /public\.tournament_final_plan_is_confirmed_manual\(entry\.id\)/,
  );
});

test("confirmed club events and explicitly reprogrammed matches still block collisions", () => {
  assert.match(migration, /public\.calendar_occupations occ/);
  assert.equal(
    (migration.match(/published\.match_id=other\.match_id/g) ?? []).length,
    2,
  );
  assert.match(migration, /published\.match_id=previous\.id/);
  assert.match(migration, /slot\.play_date between earliest_date and latest_date/);
});

test("an unpublishable preview is cleared and can become an automatically scheduled fixture", () => {
  assert.match(migration, /delete from public\.tournament_match_planning p/);
  assert.match(migration, /p\.source='manual'/);
  assert.match(migration, /source='generated',updated_at=now\(\)/);
  assert.match(migration, /and \(source is distinct from 'manual'/);
  assert.match(migration, /revoke all on function public\.auto_assign_ready_tournament_final_slots/);
});
