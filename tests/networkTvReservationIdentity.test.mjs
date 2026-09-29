import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260929223000_use_network_identity_for_tv_reservation_names.sql",
    import.meta.url,
  ),
  "utf8",
);

test("le mode TV résout les réservants dans le club affiché", () => {
  assert.equal(
    (
      migration.match(
        /profile_club_member_id\(profile\.id, settings\.club_id\)/g,
      ) ?? []
    ).length,
    2,
  );
  assert.doesNotMatch(migration, /member\.id = profile\.member_id/);
});
