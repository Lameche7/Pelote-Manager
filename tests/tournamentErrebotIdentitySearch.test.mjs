import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/migrations/20260831124000_fix_errebot_identity_candidate_search.sql",
  "utf8",
);

test("la recherche manuelle Errebot ne dépend pas du téléphone", () => {
  assert.match(migration, /admin_search_errebot_identity_candidates/);
  assert.doesNotMatch(migration, /member\.phone/i);
  assert.doesNotMatch(migration, /normalize_tournament_phone/i);
});

test("la recherche accepte prénom et nom dans les deux ordres", () => {
  assert.match(
    migration,
    /member\.first_name_normalized\s*\|\|\s*member\.last_name_normalized/,
  );
  assert.match(
    migration,
    /member\.last_name_normalized\s*\|\|\s*member\.first_name_normalized/,
  );
});

test("la recherche traite chaque mot séparément pour les prénoms composés", () => {
  assert.match(migration, /regexp_split_to_array\(raw_search/);
  assert.match(migration, /unnest\(/);
  assert.match(migration, /member\.first_name_normalized not like/);
  assert.match(migration, /member\.last_name_normalized not like/);
});

test("la recherche manuelle conserve la recherche par licence", () => {
  assert.match(migration, /member\.licence_number_normalized/);
  assert.match(migration, /normalized_licence/);
});
