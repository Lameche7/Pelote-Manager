import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260915213000_allow_multi_club_player_affiliations.sql",
    import.meta.url,
  ),
  "utf8",
);

test("remplace l'unicité globale des licences par une unicité locale au club", () => {
  assert.match(
    migration,
    /drop index if exists public\.club_members_licence_normalized_unique/i,
  );
  assert.match(
    migration,
    /create unique index club_members_club_licence_normalized_unique[\s\S]*\(club_id, licence_number_normalized\)/i,
  );
});

test("interdit deux fiches locales du même joueur dans un même club", () => {
  assert.match(
    migration,
    /create unique index club_members_club_sport_player_unique[\s\S]*\(club_id, sport_player_id\)[\s\S]*where sport_player_id is not null/i,
  );
});

test("conserve sport_players comme identité globale", () => {
  assert.doesNotMatch(
    migration,
    /drop index if exists public\.sport_players_licence_number_unique/i,
  );
  assert.match(migration, /identité sportive globale PILOTOKI/i);
});

test("ne supprime ni club_members ni le lien de compatibilité des profils", () => {
  assert.doesNotMatch(migration, /drop table\s+public\.club_members/i);
  assert.doesNotMatch(migration, /drop column\s+member_id/i);
  assert.doesNotMatch(migration, /alter table\s+public\.profiles/i);
});
