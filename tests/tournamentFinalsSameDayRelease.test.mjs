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

test("unassigned final-stage holds expire at 08:00 on the local match day", () => {
  assert.match(migration, /generated\.phase = 'finals'/);
  assert.match(migration, /generated\.play_date \+ time '08:00'/);
  assert.match(migration, /node\.play_date \+ time '08:00'/);
  assert.match(migration, /now\(\) </);
  assert.match(migration, /at time zone resource\.timezone/);
  assert.match(migration, /coalesce\(tournament\.timezone, resource\.timezone/);
});

test("assigned tournament finals stay protected and cannot be double booked", () => {
  assert.match(migration, /from public\.tournament_match_planning planned/);
  assert.match(migration, /match\.phase = 'finals'/);
  assert.match(migration, /match\.team_a_id is not null/);
  assert.match(migration, /match\.team_b_id is not null/);
  assert.match(migration, /tstzrange\(target_starts_at, target_ends_at, '\[\)'\)/);
});

test("final-day preview cards disappear at release unless actually scheduled", () => {
  assert.match(migration, /list_public_tournament_final_day_program/);
  assert.match(migration, /node\.source = 'manual'/);
  assert.match(migration, /planned\.match_id = m\.id/);
  assert.match(migration, /e\.publication_status = 'published'/);
});
