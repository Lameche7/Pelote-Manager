import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  canManageReservation,
  reservationRange,
} from "../.test-dist/src/features/admin/reservations/domain/adminReservations.js";

const migration = fs.readFileSync(
  "supabase/migrations/20260730000200_add_admin_reservation_management.sql",
  "utf8",
);
test("les commandes vérifient le rôle admin et ne créent que pour un compte", () => {
  assert.match(migration, /is_profile_admin\(\)/g);
  assert.match(migration, /target_user_id is null/);
  assert.doesNotMatch(migration, /delete from public\.reservations/i);
});
test("la création conserve occupation, tarif métier et audit", () => {
  assert.match(migration, /assert_reservation_slot_allowed/);
  assert.match(migration, /calendar_occupations/);
  assert.match(migration, /admin_created_for_user/);
  assert.match(migration, /exclusion_violation/);
});
test("les anciennes invitées restent lisibles mais sont en lecture seule", () => {
  assert.match(migration, /r\.guest_name/);
  assert.equal(canManageReservation("confirmed", "guest"), false);
  assert.equal(canManageReservation("confirmed", "account"), true);
});
test("les périodes aujourd'hui, avenir et historique sont cohérentes", () => {
  const now = new Date("2026-07-30T12:00:00Z");
  assert.equal(reservationRange("today", now).from, "2026-07-30T00:00:00.000Z");
  assert.equal(
    reservationRange("upcoming", now).from,
    "2026-07-31T00:00:00.000Z",
  );
  assert.equal(reservationRange("history", now).to, "2026-07-30T00:00:00.000Z");
});
test("les RPC sont révoquées au public et accordées aux authentifiés", () => {
  assert.equal((migration.match(/revoke all on function/g) ?? []).length, 3);
  assert.equal((migration.match(/grant execute on function/g) ?? []).length, 3);
});
