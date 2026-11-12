import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL("../src/features/reservations/pages/ReservationsPage.tsx", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../src/features/reservations/services/reservationCalendarService.ts", import.meta.url),
  "utf8",
);
const migration = readFileSync(
  new URL(
    "../supabase/migrations/20261112193000_public_calendar_resources_by_club.sql",
    import.meta.url,
  ),
  "utf8",
);

test("le sélecteur est masqué quand un club ne dispose que d'un terrain", () => {
  assert.match(page, /resources\.length > 1/);
  assert.match(page, /\.listResources\(clubSlug\)/);
  assert.match(
    page,
    /availableResources\.some\(\(resource\) => resource\.id === current\)/,
  );
});

test("la liste des terrains publics est limitée au club demandé", () => {
  assert.match(service, /list_public_calendar_resources/);
  assert.match(migration, /resource\.club_id = \(/);
  assert.match(migration, /club\.slug = nullif\(btrim\(target_slug\), ''\)/);
  assert.match(migration, /resource\.is_active = true/);
  assert.match(
    migration,
    /grant execute on function public\.list_public_calendar_resources\(text\) to anon, authenticated/i,
  );
});
