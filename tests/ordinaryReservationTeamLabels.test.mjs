import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
const modal = read("../src/features/reservations/pages/ReservationsPage.tsx");
const booking = read(
  "../src/features/reservations/services/reservationBookingService.ts",
);
const calendar = read(
  "../src/features/reservations/services/reservationCalendarService.ts",
);
const migration = read(
  "../supabase/migrations/20261119213000_ordinary_reservation_team_labels.sql",
);
const title = read(
  "../src/features/reservations/domain/ordinaryReservationLiveTitle.ts",
);

test("optional names apply only to ordinary reservations and require both", () => {
  assert.match(modal, /!championshipContext && \(/);
  assert.match(modal, /Équipe 1/);
  assert.match(modal, /Équipe 2/);
  assert.match(modal, /incompleteTeams/);
  assert.match(modal, /identicalTeams/);
  assert.match(
    modal,
    /reservationBookingService\.create\(resource\.id, slot\.startsAt, ordinaryTeams\)/,
  );
  assert.match(modal, /ordinaryTeams\?\.teamOne|ordinaryTeams\.teamOne/);
});

test("team names are persisted on paid and direct reservations", () => {
  assert.match(booking, /saveOrdinaryReservationTeams\(created\.id, teams\)/);
  assert.match(
    booking,
    /saveOrdinaryReservationTeams\(payment\.reservation_id, teams\)/,
  );
  assert.match(booking, /set_my_reservation_team_labels/);
});

test("club calendar preserves old booking owner when labels are absent", () => {
  assert.match(calendar, /list_public_reservation_team_labels/);
  assert.match(calendar, /slot\.occupation_type === "reservation"/);
  assert.match(calendar, /: slot\.booked_by_name/);
});

test("database validates and scopes ordinary labels to booking owner", () => {
  assert.match(migration, /r\.user_id = auth\.uid\(\)/);
  assert.match(migration, /r\.championship_match_id is null/);
  assert.match(migration, /r\.status in \('pending', 'confirmed'\)/);
  assert.match(migration, /char_length\(labels_one\)/);
  assert.match(migration, /enable row level security/);
  assert.match(title, /teamOne\.trim\(\).*vs.*teamTwo\.trim\(\)/);
  assert.match(title, /timeZone: timezone/);
});
