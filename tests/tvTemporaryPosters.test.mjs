import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("les affiches temporaires proposent 24h 48h 72h et une durée personnalisée", async () => {
  const [migration, service, admin, tv, styles] = await Promise.all([
    read("../supabase/migrations/20260924130000_add_temporary_tv_posters.sql"),
    read("../src/features/admin/club/services/clubMediaService.ts"),
    read("../src/features/admin/club/components/ClubMediaManager.tsx"),
    read("../src/features/tv/pages/TvDisplayPage.tsx"),
    read("../src/features/tv/pages/TvMediaGallery.css"),
  ]);
  assert.match(migration, /\x27poster\x27/);
  assert.match(migration, /active_until timestamptz/);
  assert.match(migration, /media\.active_until > now\(\)/);
  assert.match(service, /"shop" \| "partner" \| "poster"/);
  assert.match(admin, /24 heures/);
  assert.match(admin, /48 heures/);
  assert.match(admin, /72 heures/);
  assert.match(admin, /Personnalisée/);
  assert.match(admin, /datetime-local/);
  assert.match(tv, /TvPosterView/);
  assert.match(tv, /activePosters\.map/);
  assert.match(tv, /tv-display__poster/);
  assert.match(styles, /\.tv-display__poster img/);
  assert.match(styles, /object-fit: contain/);
});
