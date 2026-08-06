import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("les paramètres TV sont isolés par club et réservés aux administrateurs", async () => {
  const migration = await read(
    "../supabase/migrations/20260806150000_add_tv_mode_settings.sql",
  );

  assert.match(migration, /create table public\.club_tv_settings/);
  assert.match(migration, /create table public\.club_tv_resources/);
  assert.match(migration, /create function public\.admin_get_tv_settings\(\)/);
  assert.match(
    migration,
    /create function public\.admin_save_tv_settings\(payload jsonb\)/,
  );
  assert.match(
    migration,
    /create function public\.admin_rotate_tv_token\(\)/,
  );
  assert.match(migration, /public\.admin_current_club_id\(\)/);
  assert.match(
    migration,
    /public\.has_club_permission\(club, 'settings\.manage'\)/,
  );
  assert.match(migration, /resources\.club_id = club/);
  assert.match(migration, /resources\.is_active/);
  assert.match(migration, /public_token uuid not null default gen_random_uuid\(\)/);
  assert.match(migration, /club_tv_settings_public_token_unique/);
  assert.match(migration, /revoke all on table public\.club_tv_settings/);
  assert.match(
    migration,
    /grant execute on function public\.admin_get_tv_settings\(\) to authenticated/,
  );
});

test("les règles empêchent une configuration TV incohérente", async () => {
  const migration = await read(
    "../supabase/migrations/20260806150000_add_tv_mode_settings.sql",
  );

  assert.match(migration, /display_end_time > display_start_time/);
  assert.match(migration, /visible_slot_count between 1 and 24/);
  assert.match(
    migration,
    /refresh_interval_seconds in \(15, 30, 60, 120, 300\)/,
  );
  assert.match(
    migration,
    /Sélectionnez au moins un terrain avant d’activer le Mode TV/,
  );
  assert.match(migration, /Un terrain ne peut être sélectionné qu’une fois/);
  assert.match(migration, /token_rotated/);
});

test("l’administration expose un écran complet et un lien révocable", async () => {
  const [service, page, navigation, router, routes] = await Promise.all([
    read("../src/features/admin/settings/services/adminTvSettingsService.ts"),
    read("../src/features/admin/settings/pages/AdminTvSettingsPage.tsx"),
    read("../src/features/admin/config/adminPermissions.ts"),
    read("../src/app/router.tsx"),
    read("../src/shared/config/routes.ts"),
  ]);

  assert.match(service, /supabase\.rpc\("admin_get_tv_settings"\)/);
  assert.match(service, /supabase\.rpc\("admin_save_tv_settings"/);
  assert.match(service, /supabase\.rpc\("admin_rotate_tv_token"\)/);
  assert.match(page, /Mode TV/);
  assert.match(page, /Terrains affichés/);
  assert.match(page, /Actualisation automatique/);
  assert.match(page, /Régénérer le lien/);
  assert.match(page, /18h30/);
  assert.match(page, /Réservé/);
  assert.match(routes, /tv: "\/tv"/);
  assert.match(
    navigation,
    /label: "Paramètres"[\s\S]*?permission: ADMIN_PERMISSIONS\.settings/,
  );
  assert.doesNotMatch(
    navigation,
    /label: "Paramètres"[\s\S]*?enabled: false/,
  );
  assert.match(router, /AdminTvSettingsPage/);
  assert.match(router, /<AdminTvSettingsPage \/>/);
});
