import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260929150000_use_network_identity_for_remaining_tournament_notifications.sql",
    import.meta.url,
  ),
  "utf8",
);

test("le report appliqué résout la fiche membre dans le club du tournoi", () => {
  assert.match(
    migration,
    /profile_club_member_id\(profile\.id, target\.club_id\)/,
  );
});

test("les diffusions club résolvent le profil par identité Network", () => {
  const resolver =
    /profile\.id = public\.club_member_profile_id\(member\.id\)/g;
  const uses = migration.match(resolver);

  assert.equal(uses?.length, 2);
});

test("les anciens raccords directs ont disparu du lot", () => {
  assert.doesNotMatch(migration, /profile\.member_id = member\.id/);
  assert.doesNotMatch(migration, /member\.id = profile\.member_id/);
});
