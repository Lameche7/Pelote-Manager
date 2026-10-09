import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260930001000_network_licence_admin_linking.sql",
    import.meta.url,
  ),
  "utf8",
);

test("le preview admin accepte une identité déjà présente dans un autre club", () => {
  assert.doesNotMatch(migration, /Ce compte est déjà rattaché à un autre club/);
  assert.match(
    migration,
    /profile_club_member_id\(profile_id_value, current_club\)/,
  );
});

test("le rattachement admin préserve le membre historique du profil", () => {
  assert.match(
    migration,
    /set member_id = coalesce\(member_id, member_row\.id\)/,
  );
  assert.match(
    migration,
    /linked_member\.sport_player_id = member_row\.sport_player_id/,
  );
});

test("le club de licence par défaut vient de l'affiliation sportive", () => {
  assert.match(migration, /affiliation\.affiliation_type = 'primary'/);
  assert.doesNotMatch(
    migration,
    /public\.profiles profile\s+left join public\.club_members member on member\.id = profile\.member_id/,
  );
});

test("le fallback du mode de paiement utilise les clubs licence Network", () => {
  assert.match(migration, /from public\.list_my_licence_clubs\(\)/);
  assert.match(migration, /target_payment_id is not null/);
});
