import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("les médias TV sont stockés par club avec des droits stricts", async () => {
  const migration = await read(
    "../supabase/migrations/20260807100000_add_club_tv_media.sql",
  );

  assert.match(migration, /create table public\.club_tv_media/);
  assert.match(migration, /kind in \('shop', 'partner'\)/);
  assert.match(migration, /alter table public\.club_tv_media enable row level security/);
  assert.match(migration, /public\.has_club_permission\(club_id, 'club\.manage'\)/);
  assert.match(migration, /storage_path like club_id::text \|\| '\/%'/);
  assert.match(migration, /'club-tv-media'/);
  assert.match(migration, /8388608/);
  assert.match(migration, /'image\/jpeg', 'image\/png', 'image\/webp'/);
  assert.match(migration, /storage\.foldername\(name\)/);
});

test("la projection publique des médias exige le jeton Mode TV actif", async () => {
  const migration = await read(
    "../supabase/migrations/20260807100000_add_club_tv_media.sql",
  );

  assert.match(
    migration,
    /create or replace function public\.list_public_tv_media\(target_token uuid\)/,
  );
  assert.match(migration, /settings\.public_token = target_token/);
  assert.match(migration, /settings\.is_enabled/);
  assert.match(migration, /join public\.club_tv_media as media/);
  assert.match(
    migration,
    /grant execute on function public\.list_public_tv_media\(uuid\) to anon, authenticated/,
  );
  assert.doesNotMatch(
    migration,
    /guest_email|guest_phone|affiliation_number|membership_valid_until/,
  );
});

test("Infos du Club permet l'ajout multiple et la suppression des dotations et partenaires", async () => {
  const [service, component] = await Promise.all([
    read("../src/features/admin/club/services/clubMediaService.ts"),
    read("../src/features/admin/club/components/ClubMediaManager.tsx"),
  ]);

  assert.match(service, /const MEDIA_BUCKET = "club-tv-media"/);
  assert.match(service, /MAX_FILE_SIZE_BYTES = 8 \* 1024 \* 1024/);
  assert.match(service, /image\/jpeg/);
  assert.match(service, /crypto\.randomUUID\(\)/);
  assert.match(service, /storagePath = `\$\{clubId\}\/\$\{kind\}\//);
  assert.match(service, /\.upload\(storagePath, file/);
  assert.match(service, /\.remove\(\[storagePath\]\)/);
  assert.match(component, /Photos des vêtements/);
  assert.match(component, /Logos et plaquettes/);
  assert.match(component, /multiple/);
  assert.match(component, /accept="image\/jpeg,image\/png,image\/webp"/);
  assert.match(component, /clubMediaService\.remove\(item\)/);
});

test("le Mode TV affiche les galeries dotations et partenaires sans exposer le jeton", async () => {
  const [service, page, styles] = await Promise.all([
    read("../src/features/tv/services/tvMediaService.ts"),
    read("../src/features/tv/pages/TvDisplayPage.tsx"),
    read("../src/features/tv/pages/TvMediaGallery.css"),
  ]);

  assert.match(service, /supabase\.rpc\("list_public_tv_media"/);
  assert.match(service, /target_token: token/);
  assert.match(service, /getPublicUrl\(storagePath\)/);
  assert.match(page, /const MAX_SHOP_MEDIA = 6/);
  assert.match(page, /const MAX_PARTNER_MEDIA = 8/);
  assert.match(page, /item\.kind === "shop"/);
  assert.match(page, /item\.kind === "partner"/);
  assert.match(page, /tv-display__shop-media/);
  assert.match(page, /tv-display__partner-media/);
  assert.match(styles, /object-fit: contain/);
  assert.doesNotMatch(service, /getPublicUrl\(token\)/);
});
