import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const domainUrl = new URL(
  "../src/features/admin/championships/domain/championshipStandingsImport.ts",
  import.meta.url,
);
const sourceReaderUrl = new URL(
  "../api/championship-standings-source.mjs",
  import.meta.url,
);
const sourceServiceUrl = new URL(
  "../src/features/admin/championships/services/championshipSourceFileService.ts",
  import.meta.url,
);
const standingsServiceUrl = new URL(
  "../src/features/admin/championships/services/championshipStandingsService.ts",
  import.meta.url,
);
const cardUrl = new URL(
  "../src/features/admin/championships/components/ChampionshipStandingsImportCard.tsx",
  import.meta.url,
);
const adminIntegrationUrl = new URL(
  "../src/features/admin/championships/components/ChampionshipResultSettingsCard.tsx",
  import.meta.url,
);
const playerServiceUrl = new URL(
  "../src/features/user-space/championships/services/myChampionshipsService.ts",
  import.meta.url,
);
const migrationUrl = new URL(
  "../supabase/migrations/20260906183505_add_championship_official_standings_import.sql",
  import.meta.url,
);

const read = (url) => readFile(url, "utf8");

test("le parseur de classement accepte les intitulés officiels courants", async () => {
  const domain = await read(domainUrl);

  assert.match(domain, /categorie/);
  assert.match(domain, /serie/);
  assert.match(domain, /poule/);
  assert.match(domain, /classement equipe/);
  assert.match(domain, /club num equipe/);
  assert.match(domain, /points/);
  assert.match(domain, /goal-average/);
});

test("la lecture officielle se fait côté serveur sans copier-coller", async () => {
  const reader = await read(sourceReaderUrl);

  assert.match(reader, /lbpb\.competition\.ffpb\.net/);
  assert.match(reader, /ALLOWED_HOSTS/);
  assert.match(reader, /FFPB_COMPETITION/);
  assert.match(reader, /categoryOptions/);
  assert.match(reader, /WD_BUTTON_CLICK_/);
  assert.match(reader, /I54/);
  assert.match(reader, /for \(const division of divisions\)/);
  assert.match(reader, /parseStandings/);
});

test("le lecteur refuse une source externe arbitraire", async () => {
  const reader = await read(sourceReaderUrl);

  assert.match(reader, /if \(!ALLOWED_HOSTS\.has\(url\.hostname\)\)/);
  assert.match(reader, /Cette source officielle n’est pas prise en charge/);
});

test("les empreintes du classement restent traçables", async () => {
  const source = await read(sourceServiceUrl);

  assert.match(source, /describeStandings/);
  assert.match(source, /SHA-256/);
  assert.match(source, /kind: "standings"/);
});

test("le serveur prévisualise puis applique sans recalculer le classement", async () => {
  const [migration, service] = await Promise.all([
    read(migrationUrl),
    read(standingsServiceUrl),
  ]);

  assert.match(migration, /admin_preview_championship_standings_import/);
  assert.match(migration, /admin_apply_championship_standings_import/);
  assert.match(migration, /championship_club_can_manage/);
  assert.match(migration, /source_file\.kind = 'standings'/);
  assert.match(migration, /'alreadyImported'/);
  assert.match(migration, /'standings\.imported'/);
  assert.match(service, /admin_preview_championship_standings_import/);
  assert.match(service, /admin_apply_championship_standings_import/);
});

test("une poule partielle ne peut pas effacer un classement officiel complet", async () => {
  const migration = await read(migrationUrl);

  assert.match(migration, /expected_team_count/);
  assert.match(migration, /supplied_team_count/);
  assert.match(migration, /'incomplete_pool'/);
  assert.match(migration, /Le classement de la poule est incomplet/);
});

test("l'administration propose une actualisation automatique et compacte", async () => {
  const [card, integration] = await Promise.all([
    read(cardUrl),
    read(adminIntegrationUrl),
  ]);

  assert.match(card, /Actualiser depuis la fédération/);
  assert.match(card, /\/api\/championship-standings-source/);
  assert.match(card, /Lire le classement officiel/);
  assert.match(card, /Appliquer le classement officiel/);
  assert.doesNotMatch(card, /textarea/);
  assert.doesNotMatch(card, /presse-papiers/);
  assert.match(integration, /ChampionshipStandingsImportCard/);
  assert.match(integration, /championshipImportService\.detail/);
});

test("l'espace joueur reçoit les valeurs officielles avec un indicateur de provenance", async () => {
  const [migration, service] = await Promise.all([
    read(migrationUrl),
    read(playerServiceUrl),
  ]);

  assert.match(migration, /'official_points', pool_standing\.points/);
  assert.match(migration, /'stats_source'/);
  assert.match(migration, /coalesce\(pool_standing\.played, stats\.played, 0\)/);
  assert.match(service, /officialPoints/);
  assert.match(service, /statsSource/);
  assert.match(service, /standing\.stats_source === "official"/);
});
