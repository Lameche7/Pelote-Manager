import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260915184500_add_global_player_identity_foundation.sql",
  "utf8",
);

test("crée une identité sportive globale unique par licence", () => {
  assert.match(migration, /create table public\.sport_players/i);
  assert.match(migration, /unique \(licence_number\)/i);
  assert.match(migration, /Identité sportive globale PILOTOKI/i);
  assert.match(
    migration,
    /regexp_replace\([\s\S]*licence_number_normalized[\s\S]*'\[\^0-9\]\+'[\s\S]*'g'/i,
  );
});

test("sépare l'identité globale des affiliations club", () => {
  assert.match(
    migration,
    /create table public\.sport_player_club_affiliations/i,
  );
  assert.match(
    migration,
    /affiliation_type in \('primary', 'extension', 'unknown'\)/i,
  );
  assert.match(migration, /sport_player_id, club_id/i);
});

test("conserve les parcours PCL historiques pendant la transition", () => {
  assert.match(
    migration,
    /alter table public\.club_members[\s\S]*add column sport_player_id/i,
  );
  assert.match(
    migration,
    /alter table public\.profiles[\s\S]*add column sport_player_id/i,
  );
  assert.doesNotMatch(migration, /drop column member_id/i);
  assert.doesNotMatch(migration, /drop table public\.club_members/i);
  assert.doesNotMatch(
    migration,
    /alter column sport_player_id set not null/i,
  );
});

test("backfill sans inventer une extension ou un club principal", () => {
  assert.match(migration, /'unknown'[\s\S]*member\.is_active/i);
  assert.match(migration, /source_member_id/i);
  assert.match(
    migration,
    /Global player backfill incomplete for club_members/i,
  );
});

test("normalise aussi les licences du championnat en chiffres seuls", () => {
  assert.match(
    migration,
    /regexp_replace\([\s\S]*championship_player\.licence_number[\s\S]*'\[\^0-9\]\+'[\s\S]*'g'[\s\S]*= player\.licence_number/i,
  );
});

test("protège le lien global du profil contre les mises à jour directes", () => {
  assert.match(
    migration,
    /create function public\.protect_profile_sport_player_link\(\)/i,
  );
  assert.match(
    migration,
    /before update of sport_player_id on public\.profiles/i,
  );
  assert.match(
    migration,
    /app\.allow_profile_sport_player_link/i,
  );
});

test("ne rend pas les identités globales directement accessibles au client", () => {
  assert.match(
    migration,
    /alter table public\.sport_players enable row level security/i,
  );
  assert.match(
    migration,
    /alter table public\.sport_player_club_affiliations enable row level security/i,
  );
  assert.match(
    migration,
    /revoke all on table public\.sport_players from anon, authenticated/i,
  );
  assert.match(
    migration,
    /revoke all on table public\.sport_player_club_affiliations from anon, authenticated/i,
  );
});
