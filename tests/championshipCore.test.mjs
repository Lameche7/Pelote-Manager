import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260904211000_add_championship_core.sql",
  import.meta.url,
);

const readMigration = () => readFile(migrationUrl, "utf8");

test("le cœur championnat a sa permission dédiée", async () => {
  const sql = await readMigration();

  assert.match(sql, /'championships\.manage'/);
  assert.match(sql, /where roles\.key = 'administrator'/);
});

test("une compétition est globale et les clubs abonnés sont liés séparément", async () => {
  const sql = await readMigration();

  assert.match(sql, /create table public\.championships/);
  assert.match(sql, /source_external_id text/);
  assert.match(sql, /create table public\.championship_federation_clubs/);
  assert.match(
    sql,
    /linked_club_id uuid references public\.clubs \(id\) on delete set null/,
  );
  assert.match(sql, /create table public\.championship_club_links/);
  assert.match(sql, /access_role public\.championship_club_access_role/);
});

test("l’identité sportive est globale par source et numéro de licence", async () => {
  const sql = await readMigration();

  assert.match(sql, /create table public\.championship_players/);
  assert.match(sql, /unique \(source_provider, licence_number\)/);
  assert.match(sql, /profile_id uuid references public\.profiles \(id\) on delete set null/);
  assert.match(sql, /championship_players_profile_unique/);
});

test("les équipes et rencontres restent dans leur division", async () => {
  const sql = await readMigration();

  assert.match(
    sql,
    /unique \(division_id, federation_club_id, team_number\)/,
  );
  assert.match(
    sql,
    /foreign key \(pool_id, division_id\)[\s\S]*?references public\.championship_pools \(id, division_id\)[\s\S]*?on delete restrict/,
  );
  assert.match(
    sql,
    /foreign key \(team1_id, division_id\)[\s\S]*?references public\.championship_teams \(id, division_id\)[\s\S]*?on delete restrict/,
  );
  assert.doesNotMatch(
    sql,
    /references public\.championship_pools \(id, division_id\)\s+on delete set null/,
  );
});

test("les imports officiels gardent leur provenance et leurs types", async () => {
  const sql = await readMigration();

  assert.match(sql, /create table public\.championship_import_batches/);
  assert.match(sql, /create table public\.championship_import_files/);
  for (const kind of ["matches", "engagements", "standings", "rules"]) {
    assert.match(sql, new RegExp(`'${kind}'`));
  }
  assert.match(sql, /checksum text not null/);
  assert.match(sql, /source_import_file_id uuid/);
});

test("le classement officiel est stocké sans imposer encore un moteur de calcul", async () => {
  const sql = await readMigration();

  assert.match(sql, /create table public\.championship_standings/);
  assert.match(sql, /rank integer/);
  assert.match(sql, /points numeric/);
  assert.match(sql, /source_payload jsonb/);
});

test("les tables championnat ne sont pas exposées directement aux clients", async () => {
  const sql = await readMigration();

  assert.match(sql, /alter table public\.championships enable row level security/);
  assert.match(
    sql,
    /revoke all on table public\.championships from public, anon, authenticated/,
  );
  assert.match(
    sql,
    /revoke all on table public\.championship_matches from public, anon, authenticated/,
  );
  assert.doesNotMatch(
    sql,
    /grant\s+(select|insert|update|delete|all)\s+on\s+table\s+public\.championship/i,
  );
});

test("l’administration du championnat passe par les droits du club", async () => {
  const sql = await readMigration();

  assert.match(sql, /create or replace function public\.championship_club_can_manage/);
  assert.match(sql, /public\.has_club_permission\(target_club_id, 'championships\.manage'\)/);
  assert.match(sql, /create or replace function public\.admin_list_championships\(\)/);
  assert.match(sql, /create or replace function public\.admin_get_championship_core\(target_id uuid\)/);
  assert.match(
    sql,
    /grant execute on function public\.admin_list_championships\(\) to authenticated/,
  );
});
