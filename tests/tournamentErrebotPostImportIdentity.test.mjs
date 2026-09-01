import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260901180000_propagate_errebot_identity_confirmation.sql",
    import.meta.url,
  ),
  "utf8",
);

test("une confirmation Errebot tardive corrige les joueurs déjà importés", () => {
  assert.match(
    migration,
    /create trigger sync_verified_errebot_identity_to_imported_players/,
  );
  assert.match(
    migration,
    /after insert or update of status, member_id, profile_id[\s\S]*tournament_external_player_identities/,
  );
  assert.match(
    migration,
    /update public\.tournament_team_players as player[\s\S]*member_id = target_member\.id/,
  );
  assert.match(migration, /first_name = target_member\.first_name/);
  assert.match(migration, /last_name = target_member\.last_name/);
  assert.match(migration, /player\.external_identity_id = new\.id/);
});

test("le rattrapage reste limité aux imports Errebot et protège les doublons", () => {
  assert.match(migration, /import_row\.source = 'errebot'/);
  assert.match(migration, /import_row\.status = 'imported'/);
  assert.match(
    migration,
    /Errebot identity appears more than once in the same imported tournament/,
  );
  assert.match(
    migration,
    /A verified member appears in more than one imported team/,
  );
});

test("le rattrapage ne touche ni planning ni résultats", () => {
  assert.doesNotMatch(migration, /update public\.tournament_matches/);
  assert.doesNotMatch(migration, /update public\.tournament_match_results/);
  assert.doesNotMatch(migration, /delete from public\.tournament_pools/);
  assert.doesNotMatch(migration, /delete from public\.tournament_matches/);
});
