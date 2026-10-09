import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260929190000_use_network_identity_for_championships.sql",
    import.meta.url,
  ),
  "utf8",
);

test("l'import championnat résout le profil global depuis la fiche membre", () => {
  assert.match(migration, /public\.club_member_profile_id\(member\.id\)/);
  assert.doesNotMatch(migration, /on profile\.member_id = member\.id/);
});

test("les rappels championnat résolvent la fiche locale du club", () => {
  assert.match(
    migration,
    /public\.profile_club_member_id\(profile\.id, target\.club_id\)/,
  );
  assert.doesNotMatch(migration, /member\.id = profile\.member_id/);
});
