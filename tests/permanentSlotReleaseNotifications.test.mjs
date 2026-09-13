import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");
const migration =
  "../supabase/migrations/20260913141000_notify_released_permanent_slots.sql";

test("la libération d'un créneau permanent publie une notification club", async () => {
  const sql = await read(migration);

  assert.match(sql, /publish_released_permanent_slot_notification/);
  assert.match(sql, /notify_released_permanent_slot_after_status_change/);
  assert.match(sql, /new\.status = 'released'/);
  assert.match(sql, /insert into public\.club_communications/);
  assert.match(sql, /Créneau libéré ·/);
  assert.match(sql, /insert into public\.communication_deliveries/);
});

test("la diffusion cible les comptes des membres actifs sauf l'auteur", async () => {
  const sql = await read(migration);

  assert.match(sql, /from public\.club_members as member/);
  assert.match(sql, /join public\.profiles as profile/);
  assert.match(sql, /member\.is_active/);
  assert.match(sql, /profile\.id <> excluded_profile_id/);
  assert.match(sql, /permanent_slot_released/);
});

test("une notification de disponibilité propose de réserver", async () => {
  const page = await read(
    "../src/features/notifications/pages/NotificationsPage.tsx",
  );

  assert.match(page, /actionUrl === ROUTES\.reservations/);
  assert.match(page, /Réserver ce créneau/);
});
