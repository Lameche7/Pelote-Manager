import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260929090000_use_network_identity_for_tournament_player_access.sql",
    import.meta.url,
  ),
  "utf8",
);

test("les droits joueur tournoi résolvent l'adhésion dans le club organisateur", () => {
  assert.match(
    migration,
    /public\.profile_club_member_id\(\s*actor\.id,\s*tournament\.club_id\s*\)/i,
  );
  assert.doesNotMatch(migration, /player\.member_id\s*=\s*actor\.member_id/i);
});

test("le comptage optimisé relie les profils par identité sportive globale", () => {
  assert.match(
    migration,
    /profile\.sport_player_id\s*=\s*member\.sport_player_id/i,
  );
  assert.match(migration, /member\.club_id\s*=\s*team\.club_id/i);
  assert.match(migration, /profile\.member_id\s*=\s*member\.id/i);
});

test("les autorités existantes déposant, identité vérifiée et email sont conservées", () => {
  assert.match(migration, /team\.submitted_by\s*=\s*actor\.id/i);
  assert.match(
    migration,
    /identity\.status\s*=\s*'verified'[\s\S]*identity\.profile_id\s*=\s*actor\.id/i,
  );
  assert.match(
    migration,
    /lower\(btrim\(player\.email\)\)\s*=\s*lower\(btrim\(actor\.email\)\)/i,
  );
});
