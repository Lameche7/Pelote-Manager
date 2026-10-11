import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20261011170000_admin_reschedule_past_unplayed_matches.sql",
    import.meta.url,
  ),
  "utf8",
);

test("le sélecteur admin inclut les parties passées sans résultat validé", () => {
  const section = migration.split("-- admin_get_tournament_manual_reschedule_context")[1]
    .split("-- admin_get_tournament_manual_reschedule_slots_unfiltered")[0];
  assert.doesNotMatch(section, /planning\.starts_at,[\s\S]{0,150}resource\.timezone[\s\S]{0,30}> now\(\)/);
  assert.match(section, /result\.status = 'validated'/);
  assert.match(section, /tournament\.status in \('planning_published', 'in_progress'\)/);
});

test("le calcul des créneaux conserve seulement les cibles futures", () => {
  const section = migration.split("-- admin_get_tournament_manual_reschedule_slots_unfiltered")[1];
  assert.doesNotMatch(section, /Tournament match has already started/);
  assert.match(section, /candidate\.absolute_starts_at > now\(\)/);
});

test("la création admin prolonge le délai seulement pour une partie ancienne", () => {
  for (const functionName of [
    "admin_create_tournament_manual_reschedule_request",
    "admin_create_tournament_exceptional_reschedule_request",
  ]) {
    const section = migration.split(`-- ${functionName}`)[1].split("-- admin_")[0];
    assert.match(section, /if expires_at <= now\(\) then/);
    assert.match(section, /target_play_date,/);
    assert.match(section, /target_starts_at,/);
    assert.match(section, /result\.status = 'validated'/);
  }
});
