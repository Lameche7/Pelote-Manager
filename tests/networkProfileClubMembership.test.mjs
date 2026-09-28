import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL("../supabase/migrations/20260928200000_add_network_profile_club_membership_resolver.sql", import.meta.url),
  "utf8",
);

test("résout une adhésion locale par identité sportive globale avec repli historique", () => {
  assert.match(migration, /create or replace function public\.profile_club_member_id/i);
  assert.match(migration, /member\.sport_player_id = profile\.sport_player_id/i);
  assert.match(migration, /member\.id = profile\.member_id/i);
  assert.match(migration, /member\.club_id = target_club_id/i);
});

test("le resolver interne n'est pas exposé au client", () => {
  assert.match(
    migration,
    /revoke all on function public\.profile_club_member_id\(uuid, uuid\)[\s\S]*from public, anon, authenticated/i,
  );
});

test("les notifications utilisent le resolver multi-club", () => {
  assert.match(migration, /public\.profile_club_member_id\(auth\.uid\(\), deliveries\.club_id\)/i);
  assert.match(migration, /deliveries\.profile_id_at_publication = auth\.uid\(\)/i);
});

test("le contrat du profil adhérent reste compatible", () => {
  assert.match(migration, /create or replace function public\.get_my_member_profile\(\)/i);
  assert.match(migration, /legacy_member\.club_id as legacy_club_id/i);
  assert.match(migration, /actor\.sport_player_id/i);
});
