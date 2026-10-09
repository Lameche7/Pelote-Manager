import fs from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";

const migration = fs.readFileSync(
  new URL(
    "../supabase/migrations/20260929200000_use_network_identity_for_reservation_split_payment.sql",
    import.meta.url,
  ),
  "utf8",
);

test("le paiement partagé valide les joueurs dans le club du terrain", () => {
  assert.match(
    migration,
    /profile_club_member_id\(profile\.id, target_club_id\) is not null/,
  );
});

test("la recherche remonte du membre local vers le profil global", () => {
  assert.match(
    migration,
    /profile\.id = public\.club_member_profile_id\(member\.id\)/,
  );
});

test("la notification utilise la fiche locale du payeur dans le club", () => {
  assert.match(
    migration,
    /profile_club_member_id\(payer_profile\.id, resource\.club_id\)/,
  );
});

test("les raccords directs legacy ont disparu du lot", () => {
  assert.doesNotMatch(migration, /member\.id = profile\.member_id/);
  assert.doesNotMatch(migration, /profile\.member_id = member\.id/);
  assert.doesNotMatch(migration, /payer_profile\.member_id/);
});
