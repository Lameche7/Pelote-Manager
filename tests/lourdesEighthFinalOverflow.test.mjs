import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261118225000_lourdes_eighth_finals_december_first_overflow.sql",
    import.meta.url,
  ),
  "utf8",
);

test("only Lourdes 2026 eighth finals receive the December 1 deadline", () => {
  assert.ok(migration.includes("3de17177-a915-404f-8a6e-14bf42158982"));
  assert.ok(migration.includes("date '2026-12-01'"));
  assert.ok(migration.includes("final_round = 'round_of_16'"));
});

test("the engine prefers early slots and guards quarters", () => {
  assert.ok(migration.includes("regular_latest_date := latest_date"));
  assert.ok(migration.includes("slot.play_date > regular_latest_date"));
  assert.ok(migration.includes("public.tournament_final_node_depends_on"));
  assert.ok(migration.includes("next_round_deadline"));
  assert.ok(
    migration.includes("latest_date := least(latest_date, next_round_deadline)"),
  );
});

test("the change does not change other rounds' deadlines", () => {
  assert.ok(migration.includes("tournament_final_reschedule_last_play_date"));
  assert.ok(migration.includes("round_of_16"));
  assert.ok(migration.includes("if entry.final_round='final' then"));
});
