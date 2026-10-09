import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260929140000_use_network_identity_for_tournament_team_notifications.sql",
    import.meta.url,
  ),
  "utf8",
);

const functions = [
  "publish_tournament_final_match_publication_notification",
  "publish_tournament_match_day_reminder",
  "publish_tournament_match_result_reminder",
  "publish_tournament_planning_notification",
  "publish_tournament_reschedule_approval_notification",
];

test("résout le profil par l'identité sportive globale", () => {
  const globalLink = /profile\.sport_player_id = member\.sport_player_id/;

  assert.match(migration, /function public\.club_member_profile_id/);
  assert.match(migration, globalLink);
  assert.match(migration, /profile\.sport_player_id is null/);
});

test("migre les cinq notifications d'équipe", () => {
  for (const name of functions) {
    const declaration = new RegExp(`function public\\.${name}`, "i");

    assert.match(migration, declaration);
  }

  const resolver =
    /member_profile\.id = public\.club_member_profile_id\(member\.id\)/g;
  const resolverUses = migration.match(resolver);

  assert.equal(resolverUses?.length, functions.length);
  assert.doesNotMatch(migration, /member_profile\.member_id = member\.id/);
});

test("conserve les sécurités des fonctions", () => {
  const revoke = /revoke all on function public\.club_member_profile_id/;

  assert.match(migration, /security definer/);
  assert.match(migration, /set search_path = ''/);
  assert.match(migration, revoke);
});
