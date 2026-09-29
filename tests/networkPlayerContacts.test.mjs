import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260929110000_use_network_identity_for_player_contacts.sql",
    import.meta.url,
  ),
  "utf8",
);

test("les contacts championnat résolvent le profil par identité sportive globale", () => {
  assert.match(
    migration,
    /profile\.sport_player_id is not null[\s\S]*member\.sport_player_id = profile\.sport_player_id/i,
  );
  assert.match(
    migration,
    /profile\.sport_player_id is null[\s\S]*member\.id = profile\.member_id/i,
  );
});

test("les contacts tournoi résolvent aussi une identité externe par sport_player_id", () => {
  assert.match(
    migration,
    /identity_profile\.sport_player_id is not null[\s\S]*profile_member\.sport_player_id = identity_profile\.sport_player_id/i,
  );
  assert.match(
    migration,
    /identity_profile\.sport_player_id is null[\s\S]*profile_member\.id = identity_profile\.member_id/i,
  );
});

test("les contrats JSON des contacts restent inchangés", () => {
  for (const key of [
    "championship_id",
    "tournament_id",
    "team_id",
    "first_name",
    "last_name",
    "phone",
    "contact_kind",
  ]) {
    assert.match(migration, new RegExp("'" + key + "'"));
  }
});
