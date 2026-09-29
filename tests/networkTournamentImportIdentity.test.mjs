import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260929180000_use_network_identity_for_tournament_import_matching.sql", import.meta.url),
  "utf8",
);

test("la confirmation admin résout le profil global depuis le membre", () => {
  assert.match(migration, /target_profile_id := public\.club_member_profile_id\(target_member\.id\)/);
});

test("la prévisualisation résout le profil global depuis le candidat", () => {
  assert.match(migration, /candidate_profile_id := public\.club_member_profile_id\(candidate\.id\)/);
});

test("la recherche indique le compte lié via Network", () => {
  assert.match(migration, /public\.club_member_profile_id\(member\.id\) is not null as linked_account/);
});

test("les recherches directes legacy ont disparu", () => {
  assert.doesNotMatch(migration, /where profile\.member_id =/);
});
