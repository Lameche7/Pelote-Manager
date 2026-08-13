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

test("la liaison finale utilise les mêmes normalisations que la vérification publique", () => {
  assert.match(
    migration,
    /members\.licence_number_normalized\s*=\s*public\.normalize_member_licence\(licence_number\)/i,
  );
  assert.match(
    migration,
    /members\.last_name_normalized\s*=\s*public\.normalize_member_identity\(last_name\)/i,
  );
  assert.match(
    migration,
    /members\.first_name_normalized\s*=\s*public\.normalize_member_identity\(first_name\)/i,
  );
  assert.match(
    migration,
    /members\.birth_date\s*=\s*link_profile_to_member\.birth_date/i,
  );
});

test("la liaison reste contrôlée et idempotente pour le même profil", () => {
  assert.match(
    migration,
    /linked_profile_id is not null and linked_profile_id <> current_profile_id/i,
  );
  assert.match(
    migration,
    /set_config\('app\.allow_profile_member_link',\s*'on',\s*true\)/i,
  );
  assert.match(
    migration,
    /grant execute on function public\.link_profile_to_member\(text, text, text, date\) to authenticated/i,
  );
});
