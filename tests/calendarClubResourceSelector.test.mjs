import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const pagePath = "../src/features/reservations/pages/ReservationsPage.tsx";
const sqlPath = "../supabase/migrations/20261112193000_public_calendar_resources_by_club.sql";
const page = readFileSync(new URL(pagePath, import.meta.url), "utf8");
const sql = readFileSync(new URL(sqlPath, import.meta.url), "utf8");

test("un seul terrain masque le selecteur", () => {
  assert.match(page, /resources\.length > 1/);
  assert.match(page, /listResources\(clubSlug\)/);
});

test("le calendrier filtre les terrains par club", () => {
  assert.match(sql, /resource\.club_id/);
  assert.match(sql, /club\.slug/);
  assert.match(sql, /resource\.is_active = true/);
});
