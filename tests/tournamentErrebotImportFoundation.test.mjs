import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migrationPath =
  "../supabase/migrations/20260831100000_errebot_import_foundation.sql";

test("PR124 trace le fichier externe sans stocker le PDF dans la base", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /create table public\.tournament_imports/);
  assert.match(migration, /source_file_name text not null/);
  assert.match(migration, /source_file_hash text not null/);
  assert.match(migration, /parser_version text not null/);
  assert.match(migration, /summary jsonb not null/);
  assert.doesNotMatch(migration, /source_file_bytes|pdf_bytes|bytea/);
});

test("PR124 conserve l identifiant equipe Errebot apres conversion native", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /create table public\.tournament_import_team_refs/);
  assert.match(migration, /external_team_id text not null/);
  assert.match(migration, /references public\.tournament_teams/);
  assert.match(migration, /unique \(import_id, external_team_id\)/);
});

test("PR124 cree une identite externe reutilisable et distincte du joueur de tournoi", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /create table public\.tournament_external_player_identities/,
  );
  assert.match(migration, /profile_id uuid references public\.profiles/);
  assert.match(migration, /member_id uuid references public\.club_members/);
  assert.match(
    migration,
    /status in \('unmatched', 'suggested', 'verified', 'conflict'\)/,
  );
  assert.match(migration, /verification_method text/);
  assert.match(migration, /verified_at timestamptz/);
  assert.match(migration, /add column if not exists external_identity_id uuid/);
});

test("le telephone est normalise mais ne vaut jamais preuve de compte a lui seul", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /normalize_tournament_phone/);
  assert.match(migration, /first_name_normalized/);
  assert.match(migration, /last_name_normalized/);
  assert.match(migration, /phone_normalized/);
  assert.match(
    migration,
    /status <> 'verified'[\s\S]*profile_id is not null[\s\S]*verified_at is not null/,
  );
  assert.match(
    migration,
    /un numéro de téléphone n'est jamais une preuve d'identité à lui seul/i,
  );
});

test("les donnees personnelles d import restent privees", async () => {
  const migration = await read(migrationPath);

  for (const table of [
    "tournament_imports",
    "tournament_external_player_identities",
    "tournament_import_team_refs",
  ]) {
    assert.match(
      migration,
      new RegExp(`alter table public\\.${table} enable row level security`),
    );
    assert.match(
      migration,
      new RegExp(
        `revoke all on table public\\.${table}[\\s\\S]*from public, anon, authenticated`,
      ),
    );
  }
});
