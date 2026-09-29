import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260929160000_use_network_identity_for_tournament_registration.sql",
    import.meta.url,
  ),
  "utf8",
);

test("l'inscription résout le membre dans le club du tournoi", () => {
  assert.match(
    migration,
    /profile_club_member_id\(current_profile\.id, target_club_id\)/,
  );
});

test("la recherche partenaire exclut la fiche locale Network", () => {
  assert.match(
    migration,
    /profile_club_member_id\(target_user_id, target_club_id\)/,
  );
});

test("le comptage d'équipe résout le profil global", () => {
  assert.match(
    migration,
    /profile\.id = public\.club_member_profile_id\(member\.id\)/,
  );
});

test("les trois anciens raccords d'identité ont disparu", () => {
  assert.doesNotMatch(migration, /current_profile\.member_id/);
  assert.doesNotMatch(migration, /select profile\.member_id/);
  assert.doesNotMatch(migration, /or profile\.member_id = member\.id/);
});
