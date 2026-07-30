import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260730000300_harden_reservation_profiles.sql",
    import.meta.url,
  ),
  "utf8",
);

test("crée le profil visiteur avec son identité issue des métadonnées Auth", () => {
  assert.match(migration, /new\.raw_user_meta_data ->> 'first_name'/);
  assert.match(migration, /new\.raw_user_meta_data ->> 'last_name'/);
  assert.match(
    migration,
    /nullif\(btrim\(concat_ws\(' ', given_name, family_name\)\), ''\)/,
  );
  assert.match(
    migration,
    /after insert or update of raw_user_meta_data, email on auth\.users/,
  );
});

test("finalise un profil licencié avec l’identité du registre et member_id", () => {
  assert.match(migration, /set member_id = target_member\.id,/);
  assert.match(migration, /first_name = target_member\.first_name,/);
  assert.match(migration, /last_name = target_member\.last_name,/);
  assert.match(
    migration,
    /display_name = concat_ws\(' ', target_member\.first_name, target_member\.last_name\)/,
  );
});

test("l’annulation utilisateur met à jour la réservation, l’occupation et l’audit", () => {
  assert.match(migration, /where settings\.id = true/);
  assert.match(
    migration,
    /update public\.reservations set status = 'cancelled'/,
  );
  assert.match(
    migration,
    /update public\.calendar_occupations set cancelled_at/,
  );
  assert.match(
    migration,
    /where reservation_id = target_reservation_id and cancelled_at is null/,
  );
  assert.match(migration, /insert into public\.reservation_audit_log/);
  assert.match(migration, /'cancelled_by_customer'/);
});

test("la commande d’annulation reste réservée aux comptes authentifiés", () => {
  assert.match(
    migration,
    /revoke all on function public\.cancel_my_reservation\(uuid\) from public/,
  );
  assert.match(
    migration,
    /grant execute on function public\.cancel_my_reservation\(uuid\) to authenticated/,
  );
});
