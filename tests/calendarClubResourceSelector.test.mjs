import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL(
    "../src/features/reservations/pages/ReservationsPage.tsx",
    import.meta.url,
  ),
  "utf8",
);
const sql = readFileSync(
  new URL(
    "../supabase/migrations/20261112193000_public_calendar_resources_by_club.sql",
    import.meta.url,
  ),
  "utf8",
);

test("un seul terrain masque le selecteur", () => {
  assert.match(page, /resources\.length > 1/);
  assert.match(page, /listResources\(clubSlug\)/);
});

test("le calendrier filtre les terrains par club", () => {
  assert.match(sql, /resource\.club_id/);
  assert.match(sql, /club\.slug/);
  assert.match(sql, /resource\.is_active = true/);
});
