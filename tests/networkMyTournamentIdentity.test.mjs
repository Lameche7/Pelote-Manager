import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260929120000_use_network_identity_for_my_tournament_identity.sql",
    import.meta.url,
  ),
  "utf8",
);

test("l'identité d'inscription résout le membre du club organisateur", () => {
  assert.match(
    migration,
    /current_member_id := public\.profile_club_member_id\(\s*current_profile\.id,\s*target_club_id\s*\)/i,
  );
  assert.doesNotMatch(
    migration,
    /if current_profile\.member_id is not null then[\s\S]*where member\.id = current_profile\.member_id/i,
  );
});

test("mes participations reconnaissent toutes les adhésions de la même identité sportive", () => {
  assert.match(
    migration,
    /identity_member\.sport_player_id = current_profile\.sport_player_id/i,
  );
  assert.match(
    migration,
    /current_profile\.sport_player_id is null[\s\S]*identity\.member_id = current_profile\.member_id/i,
  );
});

test("les contrats JSON utilisateur restent inchangés", () => {
  for (const key of [
    "externalIdentityId",
    "tournamentId",
    "teamId",
    "tournamentName",
    "seriesName",
    "partnerFirstName",
    "partnerLastName",
    "role",
    "member_id",
    "first_name",
    "last_name",
    "email",
    "phone",
    "email_from_member",
    "phone_from_member",
  ]) {
    assert.match(migration, new RegExp("'" + key + "'"));
  }
});
