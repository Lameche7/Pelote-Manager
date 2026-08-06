import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("l’identité visuelle est stockée par club et validée côté serveur", async () => {
  const migration = await read(
    "../supabase/migrations/20260806180000_add_club_visual_identity.sql",
  );

  assert.match(migration, /add column hero_image_url text/);
  assert.match(migration, /add column primary_color text/);
  assert.match(migration, /add column secondary_color text/);
  assert.match(migration, /add column accent_color text/);
  assert.match(migration, /add column neutral_color text/);
  assert.match(migration, /'club\.manage'/);
  assert.match(migration, /normalized_primary_color !~ '\^#\[0-9a-f\]\{6\}\$'/);
  assert.match(migration, /URL du logo non autorisée/);
  assert.match(migration, /club_identity_audit_log/);
});

test("la projection publique expose uniquement la marque du club", async () => {
  const migration = await read(
    "../supabase/migrations/20260806180000_add_club_visual_identity.sql",
  );

  assert.match(migration, /create function public\.get_public_club_branding\(\)/);
  assert.match(migration, /club_count <> 1/);
  assert.match(migration, /'hero_image_url'/);
  assert.match(migration, /'primary_color'/);
  assert.match(
    migration,
    /grant execute on function public\.get_public_club_branding\(\) to anon, authenticated/,
  );

  const publicFunction = migration.slice(
    migration.indexOf("create function public.get_public_club_branding"),
    migration.indexOf("revoke all on function public.admin_get_club_identity"),
  );
  assert.doesNotMatch(
    publicFunction,
    /affiliation_number|email|phone|address|social_links|notes/,
  );
});

test("les images sont téléversées dans un espace isolé par club", async () => {
  const [migration, service] = await Promise.all([
    read("../supabase/migrations/20260806180000_add_club_visual_identity.sql"),
    read("../src/features/admin/club/services/clubIdentityService.ts"),
  ]);

  assert.match(migration, /'club-branding'/);
  assert.match(migration, /file_size_limit/);
  assert.match(migration, /storage\.foldername\(name\)\)\[1\]/);
  assert.match(migration, /public\.admin_current_club_id\(\)::text/);
  assert.match(service, /image\/png/);
  assert.match(service, /image\/jpeg/);
  assert.match(service, /image\/webp/);
  assert.match(service, /file\.size > 8 \* 1024 \* 1024/);
  assert.match(service, /from\("club-branding"\)\.upload/);
});

test("l’accueil, le logo et le layout consomment la marque dynamique", async () => {
  const [context, home, layout, logo, page] = await Promise.all([
    read("../src/features/branding/context/ClubBrandingContext.tsx"),
    read("../src/features/home/pages/HomePage.tsx"),
    read("../src/app/layouts/MainLayout.tsx"),
    read("../src/shared/components/ClubLogo.tsx"),
    read("../src/features/admin/club/pages/ClubInformationPage.tsx"),
  ]);

  assert.match(context, /clubBrandingService\.getPublicBranding/);
  assert.match(context, /--brand-green/);
  assert.match(context, /--brand-blue/);
  assert.match(context, /--brand-red/);
  assert.match(context, /--muted/);
  assert.match(layout, /<ClubBrandingProvider>/);
  assert.match(layout, /branding\.name/);
  assert.match(home, /branding\.heroImageUrl/);
  assert.match(home, /branding\.description/);
  assert.match(logo, /useClubBranding/);
  assert.match(page, /Enregistrer et appliquer au site/);
  assert.match(page, /Choisir un logo/);
  assert.match(page, /Choisir une photo/);
  assert.match(page, /Couleur principale/);
  assert.match(page, /Couleur secondaire/);
  assert.match(page, /Couleur d’accent/);
  assert.match(page, /Couleur neutre/);
});
