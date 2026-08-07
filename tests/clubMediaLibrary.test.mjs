import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("la médiathèque isole les médias par club et protège les écritures", async () => {
  const migration = await read(
    "../supabase/migrations/20260807110000_add_club_media_library.sql",
  );

  assert.match(migration, /create table if not exists public\.club_media_assets/);
  assert.match(migration, /kind in \('dotation', 'partner'\)/);
  assert.match(migration, /storage_path like club_id::text \|\| '\/' \|\| kind/);
  assert.match(migration, /alter table public\.club_media_assets enable row level security/);
  assert.match(migration, /has_club_permission\(club_id, 'club\.manage'\)/);
  assert.match(migration, /'club-media'/);
  assert.match(migration, /8388608/);
  assert.match(migration, /image\/jpeg/);
  assert.match(migration, /image\/png/);
  assert.match(migration, /image\/webp/);
  assert.match(migration, /can_manage_club_media_object/);
});

test("la projection publique des médias reste liée au jeton TV", async () => {
  const migration = await read(
    "../supabase/migrations/20260807110000_add_club_media_library.sql",
  );

  assert.match(
    migration,
    /create or replace function public\.get_public_tv_media\(target_token uuid\)/,
  );
  assert.match(migration, /tv_settings\.public_token = target_token/);
  assert.match(migration, /assets\.club_id = settings\.club_id/);
  assert.match(migration, /assets\.is_active/);
  assert.match(migration, /'storage_path', media\.storage_path/);
  assert.doesNotMatch(
    migration,
    /guest_email|guest_phone|affiliation_number|membership_valid_until/,
  );
});

test("l'administration téléverse, masque, ordonne et supprime les médias", async () => {
  const [service, manager, page] = await Promise.all([
    read("../src/features/admin/club/services/clubMediaService.ts"),
    read("../src/features/admin/club/components/ClubMediaManager.tsx"),
    read("../src/features/admin/club/pages/ClubInformationPage.tsx"),
  ]);

  assert.match(service, /const BUCKET = "club-media"/);
  assert.match(service, /MAX_FILE_SIZE = 8 \* 1024 \* 1024/);
  assert.match(service, /crypto\.randomUUID\(\)/);
  assert.match(service, /\.upload\(storagePath, file/);
  assert.match(service, /\.remove\(\[asset\.storagePath\]\)/);
  assert.match(manager, /type="file"/);
  assert.match(manager, /image\/jpeg,image\/png,image\/webp/);
  assert.match(manager, /Photos des dotations/);
  assert.match(manager, /Logos partenaires/);
  assert.match(manager, /Masquer/);
  assert.match(manager, /Supprimer/);
  assert.match(manager, /ArrowUp/);
  assert.match(manager, /ArrowDown/);
  assert.match(page, /<ClubMediaManager \/>/);
});

test("l'écran boutique transforme les médias actifs en galerie et plaquette partenaires", async () => {
  const [service, panel, page, styles] = await Promise.all([
    read("../src/features/tv/services/tvMediaService.ts"),
    read("../src/features/tv/components/TvPromotionPanel.tsx"),
    read("../src/features/tv/pages/TvDisplayPage.tsx"),
    read("../src/features/tv/components/TvPromotionPanel.css"),
  ]);

  assert.match(service, /supabase\.rpc\("get_public_tv_media"/);
  assert.match(service, /target_token: token/);
  assert.match(service, /getPublicUrl\(storagePath\)/);
  assert.match(panel, /MAX_DOTATIONS = 6/);
  assert.match(panel, /MAX_PARTNERS = 8/);
  assert.match(panel, /tv-display__shop-gallery/);
  assert.match(panel, /tv-display__partners-grid/);
  assert.match(panel, /Administration → Club → Informations/);
  assert.match(page, /<TvPromotionPanel/);
  assert.match(page, /shopUrl=\{SHOP_URL\}/);
  assert.match(styles, /grid-template-columns: repeat\(3, minmax\(0, 1fr\)\)/);
  assert.match(styles, /tv-display__partners-grid/);
});
