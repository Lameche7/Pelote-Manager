import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("la projection TV expose la semaine courante sans élargir les données publiques", async () => {
  const migration = await read(
    "../supabase/migrations/20260806190000_add_tv_weekly_rotation.sql",
  );

  assert.match(
    migration,
    /create or replace function public\.get_public_tv_display\(target_token uuid\)/,
  );
  assert.match(
    migration,
    /date_trunc\('week', now\(\) at time zone 'Europe\/Paris'\)/,
  );
  assert.match(migration, /week_end date := week_start \+ 6/);
  assert.match(migration, /selected\.club_id = settings\.club_id/);
  assert.match(migration, /current_occupation\.cancelled_at is null/);
  assert.match(migration, /'week_start', week_start/);
  assert.match(migration, /'week_end', week_end/);
  assert.match(migration, /'week_days', \(select days from week_payload\)/);
  assert.doesNotMatch(
    migration,
    /guest_email|guest_phone|affiliation_number|membership_valid_until/,
  );
});

test("la semaine regroupe réservations et indisponibilités par jour et terrain", async () => {
  const migration = await read(
    "../supabase/migrations/20260806190000_add_tv_weekly_rotation.sql",
  );

  assert.match(migration, /cross join week_dates as dates/);
  assert.match(migration, /'resource_id', items\.resource_id/);
  assert.match(migration, /'resource_name', items\.resource_name/);
  assert.match(migration, /then 'reserved'/);
  assert.match(migration, /else 'unavailable'/);
  assert.match(migration, /member\.first_name, member\.last_name/);
  assert.match(migration, /profile\.display_name/);
  assert.match(migration, /reservation\.guest_name/);
});

test("le service mappe la vue hebdomadaire sans modifier le lien public", async () => {
  const service = await read("../src/features/tv/services/tvDisplayService.ts");

  assert.match(service, /weekStart: string \| null/);
  assert.match(service, /weekEnd: string \| null/);
  assert.match(service, /weekDays: TvWeekDay\[\]/);
  assert.match(service, /resourceName: String\(row\.resource_name/);
  assert.match(service, /row\.week_days/);
  assert.match(service, /supabase\.rpc\("get_public_tv_display"/);
  assert.match(service, /target_token: token/);
});

test("l'écran commence par le jour puis alterne sur trois vues selon la durée configurée", async () => {
  const [page, styles] = await Promise.all([
    read("../src/features/tv/pages/TvDisplayPage.tsx"),
    read("../src/features/tv/pages/TvWeeklyView.css"),
  ]);

  assert.match(page, /type TvView = "today" \| "week" \| "club"/);
  assert.match(
    page,
    /const TV_VIEW_ORDER: TvView\[\] = \["today", "week", "club"\]/,
  );
  assert.match(page, /useState<TvView>\("today"\)/);
  assert.match(page, /setActiveView\(nextTvView\)/);
  assert.match(page, /display\.viewDurationSeconds \* 1_000/);
  assert.match(page, /Planning de la semaine/);
  assert.match(page, /Boutique & partenaires/);
  assert.match(
    page,
    /Alternance toutes les \{display\.viewDurationSeconds\} secondes/,
  );
  assert.doesNotMatch(page, /TV_VIEW_DURATION_MS = 60_000/);
  assert.match(page, /MAX_WEEK_ITEMS_PER_DAY = 5/);
  assert.match(styles, /grid-template-columns: repeat\(7, minmax\(0, 1fr\)\)/);
  assert.match(styles, /tv-display__week-item--reserved/);
  assert.match(styles, /tv-display__week-item--unavailable/);
});
