import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260930073000_network_final_identity_admin.sql",
    import.meta.url,
  ),
  "utf8",
);

test("les indicateurs de compte lié utilisent l'identité Network", () => {
  assert.match(migration, /club_member_profile_id\(member\.id\) is not null/);
  assert.doesNotMatch(migration, /where p\.member_id = member\.id/);
});

test("la liste des utilisateurs sans licence résout la fiche locale du club", () => {
  assert.match(
    migration,
    /profile_club_member_id\(profile\.id, current_club\)/,
  );
});

test("la gestion admin des réservations est cloisonnée par club", () => {
  assert.match(migration, /resource\.club_id = current_club/);
  assert.match(migration, /reservations\.manage/);
  assert.match(
    migration,
    /profile_club_member_id\(profile\.id, resource\.club_id\)/,
  );
});

test("la recherche admin des utilisateurs ne parcourt pas tous les profils", () => {
  assert.match(migration, /membership\.club_id = current_club/);
  assert.match(migration, /previous_resource\.club_id = current_club/);
});
