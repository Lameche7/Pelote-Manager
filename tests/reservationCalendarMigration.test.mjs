import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = new URL(
  "../supabase/migrations/20260730000000_show_linked_member_name_in_calendar.sql",
  import.meta.url,
);
const migration = await readFile(migrationPath, "utf8");

const memberName =
  /nullif\(\s*btrim\(concat_ws\(' ', club_member\.first_name, club_member\.last_name\)\),\s*''\s*\)/;
const displayName = /nullif\(btrim\(profile\.display_name\), ''\)/;
const guestName = /nullif\(btrim\(reservation\.guest_name\), ''\)/;

test("affiche l’identité club_members d’un profil licencié en priorité", () => {
  assert.match(
    migration,
    /create or replace function public\.list_available_slots\(/,
  );
  assert.match(
    migration,
    /left join public\.club_members as club_member\s+on club_member\.id = profile\.member_id/,
  );
  assert.match(migration, memberName);
  assert.ok(migration.search(memberName) < migration.search(displayName));
});

test("conserve le display_name d’un profil non licencié", () => {
  assert.match(migration, displayName);
  assert.ok(migration.search(displayName) < migration.search(guestName));
});

test("conserve le guest_name d’une réservation invitée sans profil", () => {
  assert.match(migration, guestName);
  assert.ok(migration.search(guestName) < migration.indexOf("'Réservation'"));
});

test("utilise Réservation lorsqu’aucun nom n’est disponible", () => {
  assert.match(
    migration,
    /nullif\(btrim\(reservation\.guest_name\), ''\),\s*'Réservation'/,
  );
});

test("conserve le titre des occupations administratives", () => {
  assert.match(
    migration,
    /else nullif\(btrim\(occupation\.title\), ''\)\s+end as booked_by_name/,
  );
});

test("conserve les droits publics du calendrier", () => {
  assert.match(
    migration,
    /grant execute on function public\.list_available_slots\(uuid, date, date\)\s+to anon, authenticated/,
  );
});
