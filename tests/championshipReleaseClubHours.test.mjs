import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261120104500_released_championship_slots_respect_opening_hours.sql",
    import.meta.url,
  ),
  "utf8",
);

test("released championship availability only includes regularly open club intervals", () => {
  assert.match(migration, /where now\(\) < coalesce\(/);
  assert.match(migration, /public\.weekend_championship_release_at\(/);
  assert.match(migration, /public\.resource_opening_hours hours/);
  assert.match(migration, /hours\.weekday = extract\(dow from period\.calendar_date\)/);
  assert.match(migration, /hours\.is_open/);
  assert.match(migration, /hours\.opens_at <= slot_local::time/);
  assert.match(
    migration,
    /hours\.closes_at >= \(slot_local \+ make_interval\(mins => period\.default_duration_minutes\)\)::time/,
  );
});

test("booking guard retains priority and released permanent slots without a championship after-release bypass", () => {
  const guard = migration.split(
    "CREATE OR REPLACE FUNCTION public.assert_reservation_slot_allowed(",
  )[1];
  assert.ok(guard);
  assert.match(guard, /not regular_opening_allowed/);
  assert.match(guard, /not championship_access\.is_priority/);
  assert.match(guard, /released_permanent_at is null/);
  assert.doesNotMatch(
    guard,
    /and now\(\) < coalesce\(public\.weekend_championship_release_at/,
  );
});

test("existing occupations remain visible outside newly restricted generated slots", () => {
  assert.match(migration, /occupations_outside_schedule as \(/);
  assert.match(migration, /'occupied'::text as status/);
  assert.match(migration, /select \* from occupations_outside_schedule/);
});
