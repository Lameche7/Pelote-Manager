import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const source = readFileSync(
  new URL(
    "../supabase/migrations/20261008195000_refereeing_current_slot_resolver.sql",
    import.meta.url,
  ),
  "utf8",
);
test("tournament slots are resolved from live match planning", () => {
  assert.match(source, /from public\.tournament_match_planning pl/);
  assert.match(source, /pl\.match_id=target_match_id/);
  assert.match(
    source,
    /public\.tournament_planning_starts_at\(pl\.play_date,pl\.starts_at,rr\.timezone\)/,
  );
});
test("championship slots are derived from live venue reservations, not historical requested time", () => {
  assert.match(source, /from public\.reservations r/);
  assert.match(source, /r\.championship_match_id=target_match_id/);
  assert.match(source, /r\.status in \('pending','confirmed'\)/);
  assert.match(source, /not exists \(/);
});
test("the resolver is an internal helper and never updates the referee", () => {
  assert.doesNotMatch(
    source,
    /update public\.referee_assignments|delete from public\.referee_assignments/i,
  );
  assert.match(
    source,
    /revoke all on function public\.refereeing_current_match_slot/,
  );
});
