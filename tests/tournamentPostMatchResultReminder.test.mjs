import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260817193000_add_tournament_post_match_result_reminders.sql";
const pagePath =
  "../src/features/user-space/tournaments/pages/MyTournamentsPage.tsx";

test("un rappel de saisie est publié après la fin d une partie sans résultat", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /result_entry_due/);
  assert.match(migration, /planning\.ends_at/);
  assert.match(migration, /not exists[\s\S]*tournament_match_results/i);
  assert.match(
    migration,
    /pelote-manager-tournament-result-entry-reminders/,
  );
  assert.match(migration, /'\*\/5 \* \* \* \*'/);
});

test("le rappel ouvre directement la partie concernée", async () => {
  const migration = await read(migrationPath);
  const page = await read(pagePath);

  assert.match(
    migration,
    /format\('\/mon-espace\/tournois\?match=%s', match_event\.match_id\)/,
  );
  assert.match(page, /searchParams\.get\("match"\)/);
  assert.match(page, /scrollIntoView/);
  assert.match(page, /if \(match\.canSubmitResult\) setEditing\(true\)/);
});

test("Mes tournois affiche les scores à saisir avant la prochaine partie", async () => {
  const page = await read(pagePath);

  assert.match(
    page,
    /actionRequiredMatches = tournament\.matches\.filter\([\s\S]*match\.canSubmitResult/,
  );
  assert.match(page, /Score à transmettre/);
  assert.match(page, /Saisir le score/);
  assert.match(page, /actionRequiredMatches\.map/);
});

test("le rappel devient inactif dès qu un résultat est enregistré", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /archive_tournament_result_entry_reminders/);
  assert.match(migration, /after insert on public\.tournament_match_results/);
  assert.match(migration, /status = 'archived'/);
});
