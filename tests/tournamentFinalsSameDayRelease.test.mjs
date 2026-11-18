import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261118221500_release_unused_final_slots_at_8.sql",
    import.meta.url,
  ),
  "utf8",
);

test("final-stage holds expire at 08:00 on the local match day", () => {
  assert.ok(migration.includes("generated.phase = 'finals'"));
  assert.ok(migration.includes("generated.play_date + time '08:00'"));
  assert.ok(migration.includes("node.play_date + time '08:00'"));
  assert.ok(migration.includes("now() <"));
  assert.ok(migration.includes("at time zone resource.timezone"));
});

test("assigned matches stay protected after 08:00", () => {
  assert.ok(migration.includes("tournament_match_planning planned"));
  assert.ok(migration.includes("match.phase = 'finals'"));
  assert.ok(migration.includes("match.team_a_id is not null"));
  assert.ok(migration.includes("match.team_b_id is not null"));
  assert.ok(migration.includes("tstzrange(target_starts_at, target_ends_at"));
});

test("unassigned final-day program cards disappear after 08:00", () => {
  assert.ok(migration.includes("list_public_tournament_final_day_program"));
  assert.ok(migration.includes("node.source = 'manual'"));
  assert.ok(migration.includes("planned.match_id = m.id"));
  assert.ok(migration.includes("e.publication_status = 'published'"));
});
