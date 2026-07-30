import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260730000100_require_account_for_reservations.sql",
  "utf8",
);

test("exige un compte et un profil pour toute nouvelle réservation", () => {
  assert.match(migration, /if actor_id is null then[\s\S]*Connexion requise/);
  assert.match(migration, /public\.profiles where id = actor_id/);
});

test("n’écrit jamais les coordonnées invité sur une nouvelle réservation", () => {
  assert.match(
    migration,
    /target_resource_id, actor_id, null, null, null, terms\.customer_type/,
  );
});

test("retire aux visiteurs anonymes les commandes de réservation", () => {
  assert.match(
    migration,
    /revoke all on function public\.create_reservation[\s\S]*from anon/,
  );
  assert.match(
    migration,
    /revoke all on function public\.reserve_for_payment[\s\S]*from anon/,
  );
});

test("conserve la traduction du conflit de concurrence", () => {
  assert.match(
    migration,
    /exception\s+when exclusion_violation then\s+raise exception 'Ce créneau vient d''être réservé par une autre personne'\s+using errcode = '23P01'/,
  );
});
