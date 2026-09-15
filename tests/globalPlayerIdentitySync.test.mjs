import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260915201500_sync_global_player_identity.sql",
  "utf8",
);

test("synchronise automatiquement les fiches club vers le joueur global", () => {
  assert.match(
    migration,
    /create function public\.sync_club_member_sport_player\(\)/i,
  );
  assert.match(
    migration,
    /create trigger sync_club_member_sport_player[\s\S]*after insert or update/i,
  );
  assert.match(migration, /on conflict \(licence_number\) do update/i);
  assert.match(migration, /sport_player_club_affiliations/i);
  assert.match(migration, /source_member_id/i);
});

test("maintient le pont profil sans ouvrir sport_player_id au client", () => {
  assert.match(
    migration,
    /set_config\('app\.allow_profile_sport_player_link', 'on', true\)/i,
  );
  assert.match(
    migration,
    /update public\.profiles[\s\S]*where member_id = new\.id/i,
  );
  assert.match(
    migration,
    /revoke all on function public\.sync_club_member_sport_player\(\) from public/i,
  );
});

test("les imports championnat alimentent le même registre global", () => {
  assert.match(
    migration,
    /create function public\.sync_championship_player_sport_player\(\)/i,
  );
  assert.match(
    migration,
    /create trigger sync_championship_player_sport_player/i,
  );
  assert.match(
    migration,
    /insert into public\.sport_players[\s\S]*from public\.championship_players/i,
  );
  assert.match(
    migration,
    /update public\.championship_players[\s\S]*sport_player_id/i,
  );
});

test("ne déduit aucune affiliation club depuis un championnat", () => {
  const championshipFunction = migration.slice(
    migration.indexOf("create function public.sync_championship_player_sport_player"),
    migration.indexOf("-- Backfill des joueurs de championnat"),
  );
  assert.doesNotMatch(championshipFunction, /sport_player_club_affiliations/i);
});

test("normalise les licences en chiffres seuls dans les deux flux", () => {
  const matches = migration.match(/\[\^0-9\]\+/g) ?? [];
  assert.ok(matches.length >= 5);
});

test("garde les fonctions de trigger hors API publique", () => {
  assert.match(migration, /security definer/i);
  assert.match(
    migration,
    /revoke all on function public\.sync_championship_player_sport_player\(\) from public/i,
  );
});
