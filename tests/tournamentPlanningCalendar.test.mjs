import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
  addDaysIso,
  buildMonthGridDays,
  buildTournamentWeeks,
  buildWeekDays,
  firstDayOfMonthIso,
  isIsoDateBetween,
  shiftMonthIso,
  startOfWeekIso,
} from "../.test-dist/src/features/tournaments/domain/planningCalendar.js";

test("la vue semaine commence toujours le lundi", () => {
  assert.equal(startOfWeekIso("2026-08-11"), "2026-08-10");
  assert.equal(startOfWeekIso("2026-08-16"), "2026-08-10");
  assert.deepEqual(buildWeekDays("2026-08-11"), [
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
    "2026-08-13",
    "2026-08-14",
    "2026-08-15",
    "2026-08-16",
  ]);
});

test("la navigation mensuelle reste stable entre les mois", () => {
  assert.equal(firstDayOfMonthIso("2026-08-31"), "2026-08-01");
  assert.equal(shiftMonthIso("2026-08-31", 1), "2026-09-01");
  assert.equal(shiftMonthIso("2026-01-15", -1), "2025-12-01");
  assert.equal(addDaysIso("2026-12-31", 1), "2027-01-01");
});

test("la vue mois couvre des semaines completes", () => {
  const days = buildMonthGridDays("2026-08-11");
  assert.equal(days[0], "2026-07-27");
  assert.equal(days.at(-1), "2026-09-06");
  assert.equal(days.length % 7, 0);
});

test("la vue tournoi couvre toute la duree sans perdre les semaines partielles", () => {
  const weeks = buildTournamentWeeks("2026-08-12", "2026-09-03");
  assert.equal(weeks.length, 4);
  assert.equal(weeks[0].start, "2026-08-10");
  assert.equal(weeks.at(-1).end, "2026-09-06");
  assert.equal(
    isIsoDateBetween("2026-08-12", "2026-08-12", "2026-09-03"),
    true,
  );
  assert.equal(
    isIsoDateBetween("2026-08-11", "2026-08-12", "2026-09-03"),
    false,
  );
});

test("l atelier planning expose semaine mois tournoi et couleurs de series", async () => {
  const page = await readFile(
    new URL(
      "../src/features/admin/tournaments/pages/AdminTournamentPlanningPage.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const migration = await readFile(
    new URL(
      "../supabase/migrations/20260811211500_add_tournament_planning_calendar_views.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(page, />\s*Semaine\s*</);
  assert.match(page, />\s*Mois\s*</);
  assert.match(page, /Tournoi complet/);
  assert.match(page, /type="color"/);
  assert.match(page, /saveSeriesColors/);
  assert.match(page, /planning-event/);

  assert.match(migration, /add column if not exists color text/i);
  assert.match(migration, /admin_update_tournament_series_colors/i);
  assert.match(migration, /'series'/i);
  assert.match(migration, /'starts_on'/i);
  assert.doesNotMatch(migration, /calendar_occupations/i);
});
