import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const profileMigration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260929233000_network_member_profile.sql",
    import.meta.url,
  ),
  "utf8",
);
const linkingMigration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260929233100_network_member_linking.sql",
    import.meta.url,
  ),
  "utf8",
);
const service = fs.readFileSync(
  new URL(
    "../src/features/user-space/profile/services/memberProfileService.ts",
    import.meta.url,
  ),
  "utf8",
);
const page = fs.readFileSync(
  new URL(
    "../src/features/user-space/profile/pages/MyProfilePage.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("Mon profil expose toutes les fiches locales du joueur global", () => {
  assert.match(profileMigration, /list_my_member_clubs/);
  assert.match(
    profileMigration,
    /member\.sport_player_id = actor\.sport_player_id/,
  );
  assert.match(profileMigration, /affiliation\.affiliation_type/);
  assert.match(profileMigration, /club\.name/);
});

test("le contrat historique get_my_member_profile reste disponible", () => {
  assert.match(profileMigration, /get_my_member_profile/);
  assert.match(profileMigration, /from public\.list_my_member_clubs/);
  assert.match(profileMigration, /limit 1/);
});

test("le rattachement utilisateur renseigne aussi l'identité sportive globale", () => {
  assert.match(linkingMigration, /from public\.sport_players as player/);
  assert.match(
    linkingMigration,
    /set sport_player_id = target_player_id|sport_player_id = target_player_id/,
  );
  assert.match(
    linkingMigration,
    /set_config\('app\.allow_profile_sport_player_link', 'on', true\)/,
  );
  assert.match(
    linkingMigration,
    /member\.sport_player_id = target_player_id/,
  );
});

test("Mon profil n'affiche plus un nom de club statique", () => {
  assert.match(service, /list_my_member_clubs/);
  assert.match(page, /memberProfileService\.listClubs/);
  assert.match(page, /club\.clubName/);
  assert.doesNotMatch(page, /CLUB_CONFIG\.name/);
});
