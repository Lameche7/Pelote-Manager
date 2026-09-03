import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260903190000_profile_linked_tournament_permissions.sql",
  import.meta.url,
);

const readMigration = () => readFile(migrationUrl, "utf8");

test("les droits tournoi reconnaissent directement une identité externe vérifiée", async () => {
  const migration = await readMigration();

  assert.match(
    migration,
    /create or replace function public\.tournament_profile_is_linked_to_team/,
  );
  assert.match(migration, /identity\.status = 'verified'/);
  assert.match(migration, /identity\.profile_id = actor\.id/);
  assert.match(migration, /player\.member_id = actor\.member_id/);
  assert.match(migration, /team\.submitted_by = actor\.id/);
});

test("l'email ne peut plus donner de droits à une participation importée", async () => {
  const migration = await readMigration();

  assert.match(
    migration,
    /player\.external_identity_id is null[\s\S]*lower\(btrim\(player\.email\)\) = lower\(btrim\(actor\.email\)\)/,
  );
  assert.doesNotMatch(
    migration,
    /identity\.profile_id = actor\.id[\s\S]*or \(\s*nullif\(btrim\(actor\.email\)/,
  );
});

test("Mes tournois repose sur le lien de compte commun", async () => {
  const migration = await readMigration();
  const getMyTournaments = migration.match(
    /create or replace function public\.get_my_tournaments\(\)[\s\S]*?grant execute on function public\.get_my_tournaments\(\) to authenticated;/,
  )?.[0];

  assert.ok(getMyTournaments);
  assert.match(
    getMyTournaments,
    /public\.tournament_profile_is_linked_to_team\(\s*team\.id,\s*current_profile_id/,
  );
  assert.doesNotMatch(getMyTournaments, /current_profile_email/);
  assert.doesNotMatch(getMyTournaments, /lower\(btrim\(player\.email\)\)/);
});

test("résultats et reports partagent la même autorité d'identité", async () => {
  const migration = await readMigration();

  assert.match(
    migration,
    /create or replace function public\.tournament_profile_can_act_for_team[\s\S]*public\.tournament_profile_is_linked_to_team/,
  );
  assert.match(
    migration,
    /create or replace function public\.tournament_profile_can_score_match[\s\S]*public\.tournament_profile_can_act_for_team/,
  );
});

test("les scénarios de qualification utilisent aussi le lien de compte", async () => {
  const migration = await readMigration();
  const qualification = migration.match(
    /create or replace function public\.get_my_tournament_qualification_scenarios\(\)[\s\S]*?grant execute on function public\.get_my_tournament_qualification_scenarios\(\)[\s\S]*?to authenticated;/,
  )?.[0];

  assert.ok(qualification);
  assert.match(
    qualification,
    /public\.tournament_profile_can_act_for_team\(\s*team\.id,\s*current_profile_id/,
  );
  assert.doesNotMatch(qualification, /player\.email/);
});

test("le helper interne de liaison n'est pas exposé directement au navigateur", async () => {
  const migration = await readMigration();

  assert.match(
    migration,
    /revoke all on function public\.tournament_profile_is_linked_to_team\(uuid, uuid\)[\s\S]*from public, anon, authenticated;/,
  );
  assert.doesNotMatch(
    migration,
    /grant execute on function public\.tournament_profile_is_linked_to_team/,
  );
});
