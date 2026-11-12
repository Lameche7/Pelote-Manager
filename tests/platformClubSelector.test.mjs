import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(
  new URL(
    "../src/features/platform/pages/PlatformDashboardPage.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("le sélecteur de plateforme lit les clubs déjà autorisés", () => {
  assert.match(source, /clubs\.map\(\(club\) =>/);
  assert.match(source, /setSelectedClubId\(event\.target\.value\)/);
});

test("le sélecteur ne prétend pas ouvrir une session métier", () => {
  assert.match(source, /lecture|consultation|consulter/);
  assert.match(source, /autorisation sécurisée dans la base métier/);
});

test("le choix d'un club reste une consultation, sans bascule de session", () => {
  assert.doesNotMatch(source, /supabase\.auth\.signInWithPassword/);
  assert.doesNotMatch(source, /supabase\.auth\.admin/);
});
