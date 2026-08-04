import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/migrations/20260803000000_harden_opening_hours_and_closures.sql",
  "utf8",
);
const calendarMigration = fs.readFileSync(
  "supabase/migrations/20260803000100_keep_existing_occupations_visible.sql",
  "utf8",
);
const page = fs.readFileSync(
  "src/features/admin/club/pages/ClubHoursPage.tsx",
  "utf8",
);

function functionBody(source, name) {
  const start = source.indexOf(`function public.${name}`);
  assert.notEqual(start, -1, `${name} doit exister`);
  const end = source.indexOf("$$;", start);
  return source.slice(start, end + 3);
}

test("les réservations restent fixées à soixante minutes", () => {
  assert.match(migration, /default_duration_minutes = 60/);
  assert.match(migration, /booking_step_minutes = 60/);
  assert.match(page, /durent toujours 60 minutes/);
  assert.doesNotMatch(page, /updateSettings/);
});

test("les horaires sont enregistrés séparément pour chaque terrain", () => {
  const sql = functionBody(migration, "admin_save_opening_hour");
  assert.match(sql, /target_resource_id uuid/);
  assert.match(sql, /resource_id = target_resource_id/);
  assert.match(page, /setResourceId/);
  assert.match(page, /listOpeningHours\(id\)/);
});

test("les commandes sont limitées au club et à la permission réservations", () => {
  const guard = functionBody(
    migration,
    "assert_reservations_manage_resource",
  );
  assert.match(guard, /resource\.club_id/);
  assert.match(guard, /has_club_permission/);
  assert.match(guard, /'reservations\.manage'/);

  for (const name of [
    "admin_list_opening_hours",
    "admin_save_opening_hour",
    "admin_delete_opening_hour",
    "admin_list_calendar_closures",
    "admin_create_calendar_closure",
    "admin_update_calendar_closure",
    "admin_delete_calendar_closure",
  ]) {
    assert.match(
      functionBody(migration, name),
      /assert_reservations_manage_resource/,
    );
  }
});

test("deux plages actives d'un même terrain ne peuvent pas se chevaucher", () => {
  const sql = functionBody(migration, "admin_save_opening_hour");
  assert.match(sql, /hours\.opens_at < target_closes_at/);
  assert.match(sql, /hours\.closes_at > target_opens_at/);
  assert.match(sql, /Cette plage chevauche un horaire existant/);
});

test("le serveur refuse une réservation hors horaires ou hors grille horaire", () => {
  const sql = functionBody(migration, "assert_reservation_slot_allowed");
  assert.match(sql, /resource_opening_hours/);
  assert.match(sql, /extract\(dow from local_start\)/);
  assert.match(sql, /hours\.opens_at <= local_start::time/);
  assert.match(sql, /hours\.closes_at >= local_end::time/);
  assert.match(sql, /local_start::time - hours\.opens_at/);
  assert.match(sql, /settings\.booking_step_minutes/);
  assert.match(sql, /mod\(/);
  assert.match(sql, /hors des horaires de réservation/);
});

test("l'onglet Fermetures dispose de toutes ses commandes", () => {
  for (const name of [
    "admin_list_calendar_closures",
    "admin_create_calendar_closure",
    "admin_update_calendar_closure",
    "admin_delete_calendar_closure",
  ]) {
    assert.match(
      migration,
      new RegExp(`grant execute on function public\\.${name}`),
    );
  }
});

test("les fermetures sont projetées dans le calendrier partagé", () => {
  assert.match(
    functionBody(migration, "admin_create_calendar_closure"),
    /insert into public\.calendar_occupations/,
  );
  assert.match(
    functionBody(migration, "admin_create_calendar_closure"),
    /'closure'/,
  );
  assert.match(
    functionBody(migration, "admin_delete_calendar_closure"),
    /cancelled_at = now\(\)/,
  );
});

test("une occupation décalée conserve ses bornes exactes", () => {
  const sql = functionBody(calendarMigration, "list_available_slots");
  assert.match(sql, /occupation\.starts_at = slot\.starts_at/);
  assert.match(sql, /occupation\.ends_at = slot\.ends_at/);
  assert.match(sql, /overlapping_occupation\.starts_at < slot\.ends_at/);
  assert.match(sql, /overlapping_occupation\.ends_at > slot\.starts_at/);
  assert.match(
    sql,
    /not \(\s*overlapping_occupation\.starts_at = slot\.starts_at\s*and overlapping_occupation\.ends_at = slot\.ends_at\s*\)/,
  );
  assert.match(sql, /slot\.starts_at = occupation\.starts_at/);
  assert.match(sql, /slot\.ends_at = occupation\.ends_at/);
});
