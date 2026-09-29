import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260929170000_use_network_identity_for_tournament_admin_accounts.sql",
    import.meta.url,
  ),
  "utf8",
);

test("la liaison admin stocke la fiche locale du club courant", () => {
  assert.match(
    migration,
    /profile_club_member_id\(target_profile\.id, current_club\)/,
  );
});

test("les candidats admin utilisent la fiche locale Network", () => {
  assert.match(
    migration,
    /profile_club_member_id\(profile\.id, current_club\)/,
  );
});

test("le remplacement résout profil et membre par identité Network", () => {
  assert.match(migration, /club_member_profile_id\(replacement_member_id\)/);
  assert.match(
    migration,
    /profile_club_member_id\(replacement_profile_id, target_tournament\.club_id\)/,
  );
});

test("les raccords legacy ciblés ont disparu", () => {
  for (const legacy of [
    "target_profile.member_id",
    "member.id = profile.member_id",
    "'memberId', profile.member_id",
    "where profile.member_id = replacement_member_id",
    "replacement_profile.member_id",
    "profile.member_id = old_player.member_id",
  ]) {
    assert.equal(migration.includes(legacy), false, legacy);
  }
});
