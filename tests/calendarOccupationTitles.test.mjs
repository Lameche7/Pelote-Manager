import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { mapCalendarOccupation } from "../.test-dist/src/features/reservations/domain/calendar.js";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260730000400_show_booker_in_public_calendar.sql",
    import.meta.url,
  ),
  "utf8",
);
const occupationRpc = migration.slice(
  migration.indexOf("create function public.list_calendar_occupations"),
  migration.indexOf("-- The weekly slot RPC"),
);

test("la RPC publique applique la priorité licencié, visiteur, display_name, invité puis fallback", () => {
  const priorities = [
    "member.first_name, member.last_name",
    "profile.first_name, profile.last_name",
    "profile.display_name",
    "reservation.guest_name",
    "'Réservation'",
  ].map((fragment) => occupationRpc.indexOf(fragment));

  assert.ok(priorities.every((position) => position >= 0));
  assert.deepEqual(
    priorities,
    [...priorities].sort((a, b) => a - b),
  );
});

test("un blocage administratif conserve son propre titre", () => {
  assert.match(
    occupationRpc,
    /else coalesce\(nullif\(btrim\(occupation\.title\), ''\), 'Indisponibilité exceptionnelle'\)/,
  );
});

test("la projection publique ne contient aucune coordonnée ni donnée de licence", () => {
  const returnedColumns = occupationRpc.slice(
    occupationRpc.indexOf("returns table"),
    occupationRpc.indexOf("language sql"),
  );
  assert.match(
    returnedColumns,
    /id uuid,\s*resource_id uuid,\s*occupation_type public\.occupation_type,\s*title text,\s*starts_at timestamptz,\s*ends_at timestamptz/,
  );
  assert.doesNotMatch(returnedColumns, /email|phone|birth_date|licence_number/);
});

test("le mapping TypeScript transmet sans altération le titre renvoyé par la RPC", () => {
  const mapped = mapCalendarOccupation({
    id: "occupation-id",
    resource_id: "court-id",
    occupation_type: "reservation",
    title: "Alain GUEMECHE",
    starts_at: "2026-08-03T16:00:00Z",
    ends_at: "2026-08-03T17:00:00Z",
  });

  assert.deepEqual(mapped, {
    id: "occupation-id",
    resourceId: "court-id",
    occupationType: "reservation",
    title: "Alain GUEMECHE",
    startsAt: "2026-08-03T16:00:00Z",
    endsAt: "2026-08-03T17:00:00Z",
  });
});
