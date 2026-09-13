import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("les rappels de créneaux permanents sont idempotents et planifiés", async () => {
  const sql = await read(
    "../supabase/migrations/20260913123000_add_permanent_slot_reminders.sql",
  );

  assert.match(sql, /create table if not exists public\.permanent_slot_reminder_events/);
  assert.match(sql, /'management_open', 'day_before_24h'/);
  assert.match(sql, /primary key \(occurrence_id, reminder_kind\)/);
  assert.match(sql, /publish_permanent_slot_reminder/);
  assert.match(sql, /publish_due_permanent_slot_reminders/);
  assert.match(sql, /'scheduled'::public\.permanent_slot_occurrence_status/);
  assert.match(sql, /management_window_hours > 24/);
  assert.match(sql, /interval '24 hours'/);
  assert.match(sql, /pelote-manager-permanent-slot-reminders/);
  assert.match(sql, /'\*\/15 \* \* \* \*'/);
});

test("les rappels passent par le moteur central de notifications", async () => {
  const sql = await read(
    "../supabase/migrations/20260913123000_add_permanent_slot_reminders.sql",
  );

  assert.match(sql, /insert into public\.club_communications/);
  assert.match(sql, /insert into public\.communication_deliveries/);
  assert.match(sql, /from public\.permanent_slot_managers/);
  assert.match(sql, /profile_id_at_publication/);
  assert.match(sql, /'published'/);
  assert.match(sql, /permanent_slot_reminder_cron/);
});

test("une décision arrête les rappels et le centre de notifications ouvre le bon écran", async () => {
  const sql = await read(
    "../supabase/migrations/20260913123000_add_permanent_slot_reminders.sql",
  );

  assert.match(sql, /archive_permanent_slot_reminders_after_decision/);
  assert.match(sql, /'confirmed'::public\.permanent_slot_occurrence_status/);
  assert.match(sql, /'released'::public\.permanent_slot_occurrence_status/);
  assert.match(sql, /'cancelled'::public\.permanent_slot_occurrence_status/);
  assert.match(sql, /communication\.status = 'published'/);
  assert.match(sql, /'\/mon-espace\/creneaux-permanents'/);
});
