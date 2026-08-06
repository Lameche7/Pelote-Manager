import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("le lien public TV est révocable et ne divulgue rien lorsqu’il est invalide", async () => {
  const migration = await read(
    "../supabase/migrations/20260806160000_add_public_tv_display.sql",
  );

  assert.match(
    migration,
    /create function public\.get_public_tv_display\(target_token uuid\)/,
  );
  assert.match(migration, /tv_settings\.public_token = target_token/);
  assert.match(migration, /jsonb_build_object\('status', 'invalid'\)/);
  assert.match(migration, /'status', 'disabled'/);
  assert.match(
    migration,
    /revoke all on function public\.get_public_tv_display\(uuid\) from public/,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_public_tv_display\(uuid\) to anon, authenticated/,
  );
  assert.doesNotMatch(
    migration,
    /guest_email|guest_phone|affiliation_number|membership_valid_until/,
  );
});

test("la projection respecte les réglages, les terrains et les créneaux à venir", async () => {
  const migration = await read(
    "../supabase/migrations/20260806160000_add_public_tv_display.sql",
  );

  assert.match(migration, /now\(\) at time zone 'Europe\/Paris'/);
  assert.match(migration, /selected\.club_id = settings\.club_id/);
  assert.match(migration, /resources\.club_id = selected\.club_id/);
  assert.match(
    migration,
    /opening_hours\.weekday = extract\(dow from display_day\)/,
  );
  assert.match(migration, /settings\.display_start_time/);
  assert.match(migration, /settings\.display_end_time/);
  assert.match(migration, /where slots\.ends_at > now\(\)/);
  assert.match(migration, /partition by slots\.resource_id/);
  assert.match(migration, /slots\.slot_rank <= settings\.visible_slot_count/);
  assert.match(migration, /order by resources\.display_order/);
});

test("l’écran distingue disponible, réservé et indisponible avec le nom public autorisé", async () => {
  const migration = await read(
    "../supabase/migrations/20260806160000_add_public_tv_display.sql",
  );

  assert.match(migration, /then 'available'/);
  assert.match(migration, /then 'reserved'/);
  assert.match(migration, /else 'unavailable'/);
  assert.match(migration, /member\.first_name, member\.last_name/);
  assert.match(migration, /profile\.first_name, profile\.last_name/);
  assert.match(migration, /profile\.display_name/);
  assert.match(migration, /reservation\.guest_name/);
  assert.match(migration, /occupation\.cancelled_at is null/);
});

test("la route TV est publique, plein écran et s’actualise selon le réglage", async () => {
  const [service, page, router, settingsPage] = await Promise.all([
    read("../src/features/tv/services/tvDisplayService.ts"),
    read("../src/features/tv/pages/TvDisplayPage.tsx"),
    read("../src/app/router.tsx"),
    read("../src/features/admin/settings/pages/AdminTvSettingsPage.tsx"),
  ]);

  assert.match(service, /supabase\.rpc\("get_public_tv_display"/);
  assert.match(service, /target_token: token/);
  assert.match(router, /path: `\$\{ROUTES\.tv\}\/\:token`/);
  assert.match(router, /element: <TvDisplayPage \/>/);
  assert.doesNotMatch(router, /ROUTES\.tv[\s\S]{0,180}<ProtectedRoute/);
  assert.match(page, /display\?\.refreshIntervalSeconds \?\? 30/);
  assert.match(page, /Réservations du jour/);
  assert.match(page, /Disponible/);
  assert.match(page, /Réservé/);
  assert.match(page, /Indisponible/);
  assert.match(page, /Lien Mode TV invalide/);
  assert.match(page, /Mode TV est actuellement désactivé/);
  assert.match(settingsPage, /Ouvrir l’écran TV/);
});
