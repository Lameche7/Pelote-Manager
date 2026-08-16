import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260816100000_add_tournament_last_day_reminders.sql",
    import.meta.url,
  ),
  "utf8",
);

test("le rappel du dernier jour est planifié et idempotent", () => {
  assert.match(migration, /create extension if not exists pg_cron/);
  assert.match(migration, /pelote-manager-tournament-last-day-reminders/);
  assert.match(migration, /'\*\/15 \* \* \* \*'/);
  assert.match(migration, /local_now::time < time '13:00'/);
  assert.match(
    migration,
    /primary key \(tournament_id, event_kind\)|on conflict \(tournament_id, event_kind\) do nothing/,
  );
  assert.match(
    migration,
    /select public\.publish_due_tournament_registration_reminders\(\);/,
  );
});

test("les inscrits reçoivent un rappel de modification", () => {
  assert.match(migration, /registration_last_day_registered/);
  assert.match(migration, /Dernier jour pour modifier/);
  assert.match(
    migration,
    /target_audience = 'registered'[\s\S]*team\.status in \('pending', 'accepted'\)/,
  );
  assert.match(migration, /Vérifiez votre équipe et vos disponibilités/);
});

test("les licenciés non inscrits reçoivent un dernier appel s il reste de la place", () => {
  assert.match(migration, /registration_last_day_unregistered/);
  assert.match(migration, /Dernier jour pour vous inscrire/);
  assert.match(
    migration,
    /target_audience = 'unregistered'[\s\S]*not exists[\s\S]*tournament_team_players/,
  );
  assert.match(
    migration,
    /tournament_series_reserved_count\(series\.id, null\) < series\.capacity/,
  );
});

test("les rappels utilisent le moteur central de notifications", () => {
  assert.match(migration, /insert into public\.club_communications/);
  assert.match(migration, /insert into public\.communication_deliveries/);
  assert.match(migration, /status = 'published'/);
  assert.match(migration, /priority,[\s\S]*'important'/);
});
