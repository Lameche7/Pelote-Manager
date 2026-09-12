import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const occupationTypeMigrationPath =
  "../supabase/migrations/20260912200500_add_private_use_occupation_type.sql";
const modelMigrationPath =
  "../supabase/migrations/20260912200600_add_permanent_slot_model.sql";
const adminMigrationPath =
  "../supabase/migrations/20260912200700_add_permanent_slot_admin_api.sql";
const userMigrationPath =
  "../supabase/migrations/20260912200800_add_permanent_slot_user_api.sql";
const bookingMigrationPath =
  "../supabase/migrations/20260912200900_integrate_permanent_slots_with_booking.sql";

test("les créneaux permanents utilisent des occupations privées du calendrier", async () => {
  const [occupationTypeMigration, modelMigration, calendarDomain] =
    await Promise.all([
      read(occupationTypeMigrationPath),
      read(modelMigrationPath),
      read("../src/features/reservations/domain/calendar.ts"),
    ]);

  assert.match(occupationTypeMigration, /add value if not exists 'private_use'/);
  assert.match(modelMigration, /create table public\.permanent_slots/);
  assert.match(modelMigration, /create table public\.permanent_slot_managers/);
  assert.match(modelMigration, /create table public\.permanent_slot_occurrences/);
  assert.match(modelMigration, /create table public\.permanent_slot_audit_log/);
  assert.match(calendarDomain, /\| "private_use"/);
});

test("l administration matérialise les occurrences et exige seulement un compte PILOTOKI", async () => {
  const migration = await read(adminMigrationPath);

  assert.match(migration, /admin_create_permanent_slot/);
  assert.match(migration, /from public\.profiles where id = target_primary_profile_id/);
  assert.doesNotMatch(migration, /is_active_licensee/);
  assert.match(migration, /'private_use'::public\.occupation_type/);
  assert.match(migration, /target_management_window_hours/);
  assert.match(migration, /admin_deactivate_permanent_slot/);
  assert.match(migration, /slot_deactivated/);
});

test("un gestionnaire peut confirmer, libérer puis reprendre tant que le créneau reste libre", async () => {
  const migration = await read(userMigrationPath);

  assert.match(migration, /list_my_permanent_slot_occurrences/);
  assert.match(migration, /set_my_permanent_slot_occurrence_status/);
  assert.match(migration, /target_status not in \('scheduled', 'confirmed', 'released'\)/);
  assert.match(migration, /management_window_hours/);
  assert.match(migration, /Ce créneau a déjà été repris par un autre utilisateur/);
  assert.match(migration, /permanent_slot_audit_log/);
});

test("une occurrence libérée réintègre la réservation sans exposer les usages privés", async () => {
  const migration = await read(bookingMigrationPath);

  assert.match(migration, /released_permanent_at/);
  assert.match(migration, /least\(booking_opens_at, released_permanent_at\)/);
  assert.match(migration, /released_slots_outside_schedule/);
  assert.match(migration, /permanent_release/);
  assert.match(migration, /<> 'private_use'/);
  assert.match(migration, /excluded_reservation_id is null/);
});

test("la documentation fixe l absence d action comme maintien du créneau", async () => {
  const documentation = await read(
    "../Docs/Reservations/01-Creneaux-permanents.md",
  );

  assert.match(documentation, /occupé par défaut/i);
  assert.match(documentation, /n'a pas besoin d'être licencié/i);
  assert.match(documentation, /libérée ponctuellement/i);
  assert.match(documentation, /aucune autre Occupation incompatible/i);
});
