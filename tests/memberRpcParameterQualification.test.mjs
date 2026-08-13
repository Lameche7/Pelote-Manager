import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260813194500_fix_member_registration_link_normalization.sql",
    import.meta.url,
  ),
  "utf8",
);

test("la vérification publique qualifie tous ses paramètres d'identité", () => {
  assert.match(
    migration,
    /normalize_member_licence\(find_member_by_licence\.licence_number\)/i,
  );
  assert.match(
    migration,
    /normalize_member_identity\(find_member_by_licence\.last_name\)/i,
  );
  assert.match(
    migration,
    /normalize_member_identity\(find_member_by_licence\.first_name\)/i,
  );
  assert.match(
    migration,
    /member\.birth_date\s*=\s*find_member_by_licence\.birth_date/i,
  );
});

test("la liaison finale qualifie tous ses paramètres d'identité", () => {
  assert.match(
    migration,
    /normalize_member_licence\(link_profile_to_member\.licence_number\)/i,
  );
  assert.match(
    migration,
    /normalize_member_identity\(link_profile_to_member\.last_name\)/i,
  );
  assert.match(
    migration,
    /normalize_member_identity\(link_profile_to_member\.first_name\)/i,
  );
  assert.match(
    migration,
    /members\.birth_date\s*=\s*link_profile_to_member\.birth_date/i,
  );
});

test("aucune normalisation RPC ne réutilise un paramètre non qualifié", () => {
  assert.doesNotMatch(
    migration,
    /normalize_member_licence\(licence_number\)/i,
  );
  assert.doesNotMatch(
    migration,
    /normalize_member_identity\((last_name|first_name)\)/i,
  );
});
