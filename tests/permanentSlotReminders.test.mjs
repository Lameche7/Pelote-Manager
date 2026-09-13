import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migration =
  "../supabase/migrations/20260913123000_add_permanent_slot_reminders.sql";

test("rappels permanents planifiés", async () => {
  const sql = await read(migration);

  assert.match(sql, /permanent_slot_reminder_events/);
  assert.match(sql, /management_open/);
  assert.match(sql, /day_before_24h/);
  assert.match(sql, /publish_permanent_slot_reminder/);
  assert.match(sql, /publish_due_permanent_slot_reminders/);
  assert.match(sql, /management_window_hours > 24/);
  assert.match(sql, /interval '24 hours'/);
  assert.match(sql, /pelote-manager-permanent-slot-reminders/);
});

test("rappels via le moteur central", async () => {
  const sql = await read(migration);

  assert.match(sql, /club_communications/);
  assert.match(sql, /communication_deliveries/);
  assert.match(sql, /permanent_slot_managers/);
  assert.match(sql, /profile_id_at_publication/);
  assert.match(sql, /permanent_slot_reminder_cron/);
});

test("décision et lien métier", async () => {
  const sql = await read(migration);

  assert.match(sql, /archive_permanent_slot_reminders_after_decision/);
  assert.match(sql, /confirmed/);
  assert.match(sql, /released/);
  assert.match(sql, /cancelled/);
  assert.match(sql, /mon-espace\/creneaux-permanents/);
});
