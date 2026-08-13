import assert from "node:assert/strict";
import test from "node:test";
import {
  addDays,
  buildWeekDays,
  groupSlotsByLocalDate,
  startOfIsoWeek,
  toDateInputValue,
} from "../.test-dist/src/features/reservations/domain/calendar.js";

test("démarre la fenêtre au jour demandé", () => {
  assert.equal(
    toDateInputValue(startOfIsoWeek(new Date(2026, 6, 28, 12))),
    "2026-07-28",
  );
  assert.equal(
    toDateInputValue(startOfIsoWeek(new Date(2026, 7, 2, 12))),
    "2026-08-02",
  );
});

test("construit sept jours glissants à partir de la date d'ancrage", () => {
  const days = buildWeekDays(new Date(2026, 6, 30, 12)).map(toDateInputValue);

  assert.deepEqual(days, [
    "2026-07-30",
    "2026-07-31",
    "2026-08-01",
    "2026-08-02",
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
  ]);
});

test("ajoute des jours sans modifier la date source", () => {
  const source = new Date(2026, 6, 28, 12);
  const result = addDays(source, 7);

  assert.equal(toDateInputValue(source), "2026-07-28");
  assert.equal(toDateInputValue(result), "2026-08-04");
});

test("regroupe les créneaux selon le fuseau Europe/Paris", () => {
  const grouped = groupSlotsByLocalDate(
    [
      {
        resourceId: "trinquet",
        startsAt: "2026-07-31T22:30:00Z",
        endsAt: "2026-07-31T23:30:00Z",
        status: "available",
      },
    ],
    "Europe/Paris",
  );

  assert.equal(grouped.get("2026-08-01")?.length, 1);
});

test("respecte le changement d'heure en Europe/Paris", () => {
  const grouped = groupSlotsByLocalDate(
    [
      {
        resourceId: "trinquet",
        startsAt: "2026-10-24T22:30:00Z",
        endsAt: "2026-10-24T23:30:00Z",
        status: "available",
      },
    ],
    "Europe/Paris",
  );

  assert.equal(grouped.get("2026-10-25")?.length, 1);
});
