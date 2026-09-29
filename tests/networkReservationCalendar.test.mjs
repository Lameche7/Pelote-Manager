import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260929220000_use_network_identity_for_reservation_calendar.sql",
    import.meta.url,
  ),
  "utf8",
);

test("les disponibilités résolvent le réservant dans le club de la ressource", () => {
  assert.match(
    migration,
    /join public\.reservable_resources as slot_resource\s+on slot_resource\.id = slot\.resource_id/,
  );
  assert.match(
    migration,
    /profile_club_member_id\(profile\.id, slot_resource\.club_id\)/,
  );
  assert.equal(
    (
      migration.match(
        /profile_club_member_id\(profile\.id, resource\.club_id\)/g,
      ) ?? []
    ).length,
    2,
  );
});

test("les rappels permanents utilisent la fiche locale du club", () => {
  assert.match(
    migration,
    /profile_club_member_id\(profile\.id, target\.club_id\)/,
  );
});

test("les raccords directs legacy ont disparu du lot", () => {
  assert.doesNotMatch(migration, /= profile\.member_id/);
});
