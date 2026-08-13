import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260813182500_restore_public_member_licence_verification.sql",
  import.meta.url,
);
const migration = await readFile(migrationPath, "utf8");

test("la vérification publique conserve la comparaison normalisée", () => {
  assert.match(migration, /licence_number_normalized = public\.normalize_member_licence\(licence_number\)/);
  assert.match(migration, /last_name_normalized = public\.normalize_member_identity\(last_name\)/);
  assert.match(migration, /first_name_normalized = public\.normalize_member_identity\(first_name\)/);
  assert.match(migration, /member\.birth_date = find_member_by_licence\.birth_date/);
});

test("un visiteur peut vérifier son identité avant de créer son compte", () => {
  assert.doesNotMatch(migration, /auth\.uid\(\)/);
  assert.match(
    migration,
    /grant execute on function public\.find_member_by_licence\(text, text, text, date\) to anon, authenticated;/,
  );
  assert.match(migration, /returns boolean/);
  assert.doesNotMatch(migration, /returns table/);
});
