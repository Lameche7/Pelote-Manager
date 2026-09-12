import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migrations = "../supabase/migrations";
const readMigration = (name) => read(`${migrations}/${name}`);
const has = (text, pattern) => assert.match(text, pattern);

test("modèle des créneaux permanents", async () => {
  const typeSql = await readMigration(
    "20260912200500_add_private_use_occupation_type.sql",
  );
  const modelSql = await readMigration(
    "20260912200600_add_permanent_slot_model.sql",
  );
  const calendar = await read(
    "../src/features/reservations/domain/calendar.ts",
  );

  has(typeSql, /add value if not exists 'private_use'/);
  has(modelSql, /create table public\.permanent_slots/);
  has(modelSql, /create table public\.permanent_slot_managers/);
  has(modelSql, /create table public\.permanent_slot_occurrences/);
  has(modelSql, /create table public\.permanent_slot_audit_log/);
  has(calendar, /\| "private_use"/);
});

test("API administration des créneaux permanents", async () => {
  const sql = await readMigration(
    "20260912200700_add_permanent_slot_admin_api.sql",
  );

  has(sql, /admin_create_permanent_slot/);
  has(sql, /from public\.profiles where id = target_primary_profile_id/);
  assert.doesNotMatch(sql, /is_active_licensee/);
  has(sql, /'private_use'::public\.occupation_type/);
  has(sql, /target_management_window_hours/);
  has(sql, /admin_deactivate_permanent_slot/);
  has(sql, /slot_deactivated/);
});

test("gestion utilisateur des occurrences", async () => {
  const sql = await readMigration(
    "20260912200800_add_permanent_slot_user_api.sql",
  );

  has(sql, /list_my_permanent_slot_occurrences/);
  has(sql, /set_my_permanent_slot_occurrence_status/);
  has(sql, /target_status not in \('scheduled', 'confirmed', 'released'\)/);
  has(sql, /management_window_hours/);
  has(sql, /Ce créneau a déjà été repris par un autre utilisateur/);
  has(sql, /permanent_slot_audit_log/);
});

test("réintégration dans le moteur de réservation", async () => {
  const sql = await readMigration(
    "20260912200900_integrate_permanent_slots_with_booking.sql",
  );

  has(sql, /released_permanent_at/);
  has(sql, /least\(booking_opens_at, released_permanent_at\)/);
  has(sql, /released_slots_outside_schedule/);
  has(sql, /permanent_release/);
  has(sql, /<> 'private_use'/);
  has(sql, /excluded_reservation_id is null/);
});

test("règles métier documentées", async () => {
  const documentation = await read(
    "../Docs/Reservations/01-Creneaux-permanents.md",
  );

  has(documentation, /occupé par défaut/i);
  has(documentation, /n'a pas besoin d'être licencié/i);
  has(documentation, /libérée ponctuellement/i);
  has(documentation, /aucune autre Occupation incompatible/i);
});
