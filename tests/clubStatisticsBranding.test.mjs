import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const migration = read(
  "supabase/migrations/20260806170000_add_club_branding_and_statistics.sql",
);
const clubPage = read(
  "src/features/admin/club/pages/ClubInformationPage.tsx",
);
const homePage = read("src/features/home/pages/HomePage.tsx");
const statisticsPage = read(
  "src/features/admin/statistics/pages/AdminStatisticsPage.tsx",
);
const navigation = read("src/features/admin/config/adminPermissions.ts");
const router = read("src/app/router.tsx");

test("club branding is stored per club with four validated colors", () => {
  assert.match(migration, /hero_image_url text/);
  assert.match(migration, /primary_color text/);
  assert.match(migration, /secondary_color text/);
  assert.match(migration, /accent_color text/);
  assert.match(migration, /neutral_color text/);
  assert.match(migration, /\^#\[0-9A-Fa-f\]\{6\}\$/);
});

test("public homepage only receives the safe branding projection", () => {
  assert.match(migration, /get_public_club_branding/);
  assert.match(migration, /grant execute[\s\S]*to anon, authenticated/);
  assert.doesNotMatch(migration, /get_public_club_branding[\s\S]*address/);
  assert.match(homePage, /clubBrandingService\.getPublicBranding/);
  assert.match(homePage, /--club-primary/);
  assert.match(homePage, /branding\.heroImageUrl/);
  assert.match(homePage, /branding\.logoUrl/);
});

test("club information page edits images and the four-color palette", () => {
  assert.match(clubPage, /URL du logo/);
  assert.match(clubPage, /photo d’arrière-plan/);
  assert.match(clubPage, /primaryColor/);
  assert.match(clubPage, /secondaryColor/);
  assert.match(clubPage, /accentColor/);
  assert.match(clubPage, /neutralColor/);
  assert.match(clubPage, /Enregistrer et appliquer/);
});

test("statistics are isolated by club and protected by permission", () => {
  assert.match(migration, /admin_current_club_id\(\)/);
  assert.match(migration, /has_club_permission\(club, 'statistics\.read'\)/);
  assert.match(migration, /rr\.club_id = club/);
  assert.match(migration, /period_end - period_start > 366/);
});

test("statistics module is enabled and replaces the placeholder route", () => {
  assert.match(statisticsPage, /Statistiques du club/);
  assert.match(statisticsPage, /Chiffre d’affaires théorique/);
  assert.match(navigation, /label: "Statistiques"/);
  assert.doesNotMatch(
    navigation,
    /label: "Statistiques"[\s\S]{0,160}enabled: false/,
  );
  assert.match(router, /<AdminStatisticsPage \/>/);
});
