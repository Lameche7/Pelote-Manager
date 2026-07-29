import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260729000700_add_club_members.sql",
  import.meta.url,
);
const migration = await readFile(migrationPath, "utf8");

function sqlFunction(name) {
  const start = migration.indexOf(`create function public.${name}(`);
  assert.notEqual(start, -1, `la fonction ${name} doit exister`);
  const end = migration.indexOf("\n$$;", start);
  assert.notEqual(end, -1, `la fonction ${name} doit être complète`);
  return migration.slice(start, end);
}

test("la vérification exige l’identité complète sans divulguer de données", () => {
  const verification = sqlFunction("find_member_by_licence");

  assert.match(verification, /licence_number text/);
  assert.match(verification, /last_name text/);
  assert.match(verification, /first_name text/);
  assert.match(verification, /birth_date date/);
  assert.match(verification, /returns boolean/);
  assert.doesNotMatch(verification, /returns table/);
  assert.match(
    verification,
    /members\.last_name = find_member_by_licence\.last_name/,
  );
  assert.match(
    verification,
    /members\.first_name = find_member_by_licence\.first_name/,
  );
  assert.match(
    verification,
    /members\.birth_date = find_member_by_licence\.birth_date/,
  );
});

test("la liaison vérifie les quatre valeurs et verrouille la licence", () => {
  const linking = sqlFunction("link_profile_to_member");

  assert.match(
    linking,
    /members\.licence_number = link_profile_to_member\.licence_number/,
  );
  assert.match(
    linking,
    /members\.last_name = link_profile_to_member\.last_name/,
  );
  assert.match(
    linking,
    /members\.first_name = link_profile_to_member\.first_name/,
  );
  assert.match(
    linking,
    /members\.birth_date = link_profile_to_member\.birth_date/,
  );
  assert.match(linking, /for update/);
  assert.match(linking, /Licence is already linked to another account/);
});

test("le statut lié est prioritaire tout en conservant le chemin historique", () => {
  const activeLicensee = migration.slice(
    migration.indexOf("create or replace function public.is_active_licensee("),
  );

  assert.match(activeLicensee, /club_members\.is_active/);
  assert.match(activeLicensee, /profiles\.member_id is null/);
  assert.match(activeLicensee, /profiles\.membership_status = 'active'/);
});
