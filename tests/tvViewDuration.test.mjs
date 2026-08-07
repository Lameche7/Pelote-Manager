import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("la durée d'affichage TV est stockée et validée côté Supabase", async () => {
  const migration = await read(
    "../supabase/migrations/20260807130000_add_tv_view_duration.sql",
  );

  assert.match(migration, /view_duration_seconds integer not null default 60/);
  assert.match(migration, /view_duration_seconds between 10 and 300/);
  assert.match(migration, /'view_duration_seconds', settings\.view_duration_seconds/);
  assert.match(migration, /target_view_duration integer/);
  assert.match(migration, /view_duration_seconds = target_view_duration/);
  assert.match(
    migration,
    /create or replace function public\.get_public_tv_view_duration\(target_token uuid\)/,
  );
  assert.match(migration, /settings\.public_token = target_token/);
  assert.match(
    migration,
    /grant execute on function public\.get_public_tv_view_duration\(uuid\) to anon, authenticated/,
  );
});

test("l'administration permet de régler la durée de chaque écran", async () => {
  const [service, page] = await Promise.all([
    read("../src/features/admin/settings/services/adminTvSettingsService.ts"),
    read("../src/features/admin/settings/pages/AdminTvSettingsPage.tsx"),
  ]);

  assert.match(service, /viewDurationSeconds: number/);
  assert.match(service, /row\.view_duration_seconds \?\? 60/);
  assert.match(service, /view_duration_seconds: settings\.viewDurationSeconds/);
  assert.match(page, /Durée de chaque écran \(secondes\)/);
  assert.match(page, /min="10"/);
  assert.match(page, /max="300"/);
  assert.match(page, /settings\.viewDurationSeconds/);
});

test("la rotation TV utilise la durée enregistrée au lieu de 60 secondes fixes", async () => {
  const [service, page] = await Promise.all([
    read("../src/features/tv/services/tvDisplayService.ts"),
    read("../src/features/tv/pages/TvDisplayPage.tsx"),
  ]);

  assert.match(service, /get_public_tv_view_duration/);
  assert.match(service, /viewDurationSeconds: clampViewDuration/);
  assert.match(page, /display\.viewDurationSeconds \* 1_000/);
  assert.match(page, /Alternance toutes les \{display\.viewDurationSeconds\} secondes/);
  assert.doesNotMatch(page, /TV_VIEW_DURATION_MS = 60_000/);
});
