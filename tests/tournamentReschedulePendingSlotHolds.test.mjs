import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260930090000_reschedule_pending_slot_holds.sql",
    import.meta.url,
  ),
  "utf8",
);

test("les créneaux visés par un report actif sont considérés occupés", () => {
  assert.match(
    migration,
    /request\.status in \('pending', 'approved'\)/,
  );
  assert.match(migration, /request\.expires_at > now\(\)/);
  assert.match(
    migration,
    /request\.target_starts_at < target_ends_at[\s\S]*request\.target_ends_at > target_starts_at/,
  );
});

test("les propositions joueur et admin filtrent les créneaux tenus", () => {
  assert.match(
    migration,
    /create or replace function public\.get_my_tournament_reschedule_options/,
  );
  assert.match(
    migration,
    /create or replace function public\.admin_get_tournament_manual_reschedule_slots/,
  );
  assert.match(
    migration,
    /not public\.tournament_reschedule_slot_is_held/,
  );
});

test("les échanges excluent aussi les matchs déjà engagés dans un report", () => {
  assert.match(
    migration,
    /tournament_reschedule_active_matches[\s\S]*active\.match_id = nullif\(item\.value->>'swap_match_id'/,
  );
});

test("la base sérialise et rejette deux demandes concurrentes sur le même créneau", () => {
  assert.match(migration, /pg_advisory_xact_lock/);
  assert.match(
    migration,
    /Tournament reschedule target slot already has an active request/,
  );
  assert.match(
    migration,
    /create trigger guard_tournament_reschedule_target_slot/,
  );
});
