import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261116115000_finals_free_slot_optional_availability.sql",
    import.meta.url,
  ),
  "utf8",
);
const service = readFileSync(
  new URL(
    "../src/features/user-space/tournaments/services/tournamentRescheduleService.ts",
    import.meta.url,
  ),
  "utf8",
);
const ui = readFileSync(
  new URL(
    "../src/features/user-space/tournaments/components/TournamentRescheduleSuggestions.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("only free slots during finals can bypass declared opponent availability", () => {
  assert.match(migration, /target_match\.phase = ''finals''/);
  assert.match(migration, /request\.proposal_kind = ''free_slot''/);
  assert.match(migration, /not measured\.opponent_has_availability/);
  assert.match(migration, /or measured\.opponent_declared_available/);
  assert.match(migration, /admin_apply_tournament_reschedule_request/);
  assert.match(migration, /get_my_tournament_reschedule_options_engine/);
});

test("free slots outside availability require explicit agreement", () => {
  assert.match(migration, /opponent_outside_declared_availability/);
  assert.match(service, /opponentOutsideDeclaredAvailability/);
  assert.match(ui, /option\.opponentOutsideDeclaredAvailability/);
  assert.match(ui, /accord explicite est indispensable/);
  assert.match(ui, /Aucune partie n’est déplacée tant que tous les accords ne/);
});

test("migration preserves database guard expectations", () => {
  assert.match(migration, /^begin;/m);
  assert.match(
    migration,
    /raise exception 'Expected finals availability filter/,
  );
  assert.match(
    migration,
    /raise exception 'Expected apply-time availability guard/,
  );
  assert.match(migration, /commit;\s*$/);
});
