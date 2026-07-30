import assert from "node:assert/strict";
import test from "node:test";
import fs from "node:fs";
import {
  canManageReservation,
  reservationRange,
  validateCalendarBlock,
} from "../.test-dist/src/features/admin/reservations/domain/adminReservations.js";
const migration = fs.readFileSync(
  "supabase/migrations/20260730000200_add_admin_reservation_management.sql",
  "utf8",
);
const body = (name) =>
  migration.slice(
    migration.indexOf(`create function public.${name}`),
    migration.indexOf(
      "end $$;",
      migration.indexOf(`create function public.${name}`),
    ) + 7,
  );
const commands = [
  "admin_manage_reservations",
  "admin_search_reservation_users",
  "admin_create_reservation_for_user",
  "admin_list_available_reservation_slots",
  "admin_preview_reservation",
  "admin_list_calendar_blocks",
  "admin_create_calendar_block",
  "admin_update_calendar_block",
  "admin_delete_calendar_block",
];

test("chaque RPC refuse réellement un appelant non administrateur", () => {
  for (const command of commands)
    assert.match(
      body(command),
      /if not public\.is_profile_admin\(\).*42501/s,
      command,
    );
});
test("la création admin exige un utilisateur, applique les règles et conserve un audit", () => {
  const sql = body("admin_create_reservation_for_user");
  assert.match(sql, /target_user_id is null/);
  assert.match(sql, /assert_reservation_slot_allowed/);
  assert.match(sql, /calendar_occupations/);
  assert.match(sql, /admin_created_for_user/);
  assert.doesNotMatch(sql, /guest_/);
});
test("l'aperçu tarifaire exige le compte et réutilise les règles métier", () => {
  const sql = body("admin_preview_reservation");
  assert.match(sql, /target_user_id is null/);
  assert.match(sql, /assert_reservation_slot_allowed/);
  assert.match(sql, /price_cents/);
});
test("le déplacement ne propose que le libre en excluant la réservation déplacée", () => {
  const sql = body("admin_list_available_reservation_slots");
  assert.match(sql, /slot\.status = 'available'/);
  assert.match(sql, /reservation_id is distinct from excluded_reservation_id/);
  assert.match(sql, /starts_at < slot\.ends_at/);
});
test("modify_reservation reste la commande de déplacement et gère les occupations", () => {
  const service = fs.readFileSync(
    "src/features/admin/reservations/services/adminReservationsService.ts",
    "utf8",
  );
  assert.match(service, /rpc\("modify_reservation"/);
  assert.match(service, /target_resource_id: resourceId/);
});
test("création, modification et suppression douce des blocages sont auditées", () => {
  assert.match(
    body("admin_create_calendar_block"),
    /calendar_occupation_audit_log.*'created'/s,
  );
  assert.match(
    body("admin_update_calendar_block"),
    /previous_data,new_data.*'updated'/s,
  );
  assert.match(
    body("admin_delete_calendar_block"),
    /cancelled_at=now\(\).*'cancelled'/s,
  );
  assert.doesNotMatch(body("admin_delete_calendar_block"), /delete from/);
});
test("les conflits de réservation et de blocage renvoient un conflit explicite", () => {
  assert.match(
    body("admin_create_reservation_for_user"),
    /exclusion_violation.*déjà occupé/s,
  );
  assert.match(
    body("admin_create_calendar_block"),
    /exclusion_violation.*déjà occupé/s,
  );
});
test("les anciennes invitées restent lisibles et strictement en lecture seule", () => {
  assert.match(body("admin_manage_reservations"), /r\.guest_name/);
  assert.equal(canManageReservation("confirmed", "guest"), false);
  assert.equal(canManageReservation("confirmed", "account"), true);
});
test("le métier refuse les blocages sans motif ou de durée négative", () => {
  assert.equal(
    validateCalendarBlock("2026-08-01T10:00", "2026-08-01T11:00", "Entretien"),
    null,
  );
  assert.match(
    validateCalendarBlock("2026-08-01T10:00", "2026-08-01T09:00", "Entretien"),
    /fin/,
  );
  assert.match(
    validateCalendarBlock("2026-08-01T10:00", "2026-08-01T11:00", " "),
    /motif/,
  );
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
test("toutes les commandes révoquent public et accordent seulement authenticated", () => {
  for (const command of commands) {
    assert.match(
      migration,
      new RegExp(`revoke all on function public\\.${command}\\(`),
    );
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${command}\\(`),
    );
  }
  assert.match(
    migration,
    /revoke all on table public\.calendar_occupation_audit_log from public, anon, authenticated/,
  );
});
