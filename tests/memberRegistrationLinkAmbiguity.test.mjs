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

test("qualifie les paramètres PL/pgSQL de link_profile_to_member", () => {
  for (const parameter of [
    "licence_number",
    "last_name",
    "first_name",
    "birth_date",
  ]) {
    assert.match(
      migration,
      new RegExp(`link_profile_to_member\\.${parameter}`, "i"),
    );
  }
});

test("n'utilise plus de paramètres non qualifiés dans les normalisations", () => {
  assert.doesNotMatch(
    migration,
    /normalize_member_licence\(licence_number\)/i,
  );
  assert.doesNotMatch(
    migration,
    /normalize_member_identity\((last_name|first_name)\)/i,
  );
});
