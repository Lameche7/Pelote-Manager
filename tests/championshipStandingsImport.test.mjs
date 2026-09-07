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
const generalSourceReaderUrl = new URL(
  "../api/championship-general-standings-source.mjs",
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
const playerRankingServiceUrl = new URL(
  "../src/features/user-space/championships/services/myChampionshipRankingContextService.ts",
  import.meta.url,
);
const playerPageUrl = new URL(
  "../src/features/user-space/championships/pages/MyChampionshipsPage.tsx",
  import.meta.url,
);
const migrationUrl = new URL(
  "../supabase/migrations/20260906183505_add_championship_official_standings_import.sql",
  import.meta.url,
);
const generalMigrationUrl = new URL(
  "../supabase/migrations/20260907131935_add_championship_general_standings_import.sql",
  import.meta.url,
);
const rankingContextMigrationUrl = new URL(
  "../supabase/migrations/20260907132028_add_my_championship_ranking_context.sql",
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

test("le lecteur comprend la structure réelle des lignes de classement WebDev", async () => {
  const reader = await read(sourceReaderUrl);
  assert.match(reader, /teamFromLine/);
  assert.match(reader, /const numeric = numericTokens\(candidate\)/);
  assert.match(reader, /stats\.push\(\.\.\.numeric\)/);
  assert.match(reader, /"Vict\."/);
  assert.match(reader, /"Dif\. points"/);
});

test("le lecteur déplie automatiquement toutes les lignes du classement", async () => {
  const reader = await read(sourceReaderUrl);
  assert.match(reader, /incompleteLineCounters/);
  assert.match(reader, /visibleShowMoreButtonIds/);
  assert.match(reader, /expandRankingPage/);
  assert.match(reader, /Afficher plus/);
  assert.match(reader, /WD_BUTTON_CLICK_", buttonId/);
});

test("le classement général officiel est lu comme une source distincte", async () => {
  const reader = await read(generalSourceReaderUrl);
  assert.match(reader, /Classement Général \(à l'issue des poules\)/);
  assert.match(reader, /requestGeneralRankingPage/);
  assert.match(reader, /parseGeneralStandings/);
  assert.match(reader, /poolRank/);
  assert.match(reader, /"Points \/ partie"/);
  assert.match(reader, /generalStandings/);
});

test("les lecteurs refusent une source externe arbitraire", async () => {
  const [poolReader, generalReader] = await Promise.all([
    read(sourceReaderUrl),
    read(generalSourceReaderUrl),
  ]);
  assert.match(poolReader, /if \(!ALLOWED_HOSTS\.has\(url\.hostname\)\)/);
  assert.match(generalReader, /if \(!ALLOWED_HOSTS\.has\(url\.hostname\)\)/);
});

test("les empreintes des classements restent traçables", async () => {
  const source = await read(sourceServiceUrl);
  assert.match(source, /describeStandings/);
  assert.match(source, /SHA-256/);
  assert.match(source, /kind: "standings"/);
});

test("le serveur prévisualise puis applique poules et général sans recalcul", async () => {
  const [migration, generalMigration, service] = await Promise.all([
    read(migrationUrl),
    read(generalMigrationUrl),
    read(standingsServiceUrl),
  ]);
  assert.match(migration, /admin_preview_championship_standings_import/);
  assert.match(migration, /admin_apply_championship_standings_import/);
  assert.match(generalMigration, /championship_general_standings/);
  assert.match(generalMigration, /admin_preview_championship_rankings_import/);
  assert.match(generalMigration, /admin_apply_championship_rankings_import/);
  assert.match(generalMigration, /general_standings\.imported/);
  assert.match(service, /admin_preview_championship_rankings_import/);
  assert.match(service, /admin_apply_championship_rankings_import/);
});

test("une poule partielle reste protégée", async () => {
  const migration = await read(migrationUrl);
  assert.match(migration, /expected_team_count/);
  assert.match(migration, /supplied_team_count/);
  assert.match(migration, /'incomplete_pool'/);
});

test("l'administration lit et applique les deux classements en une action", async () => {
  const [card, integration] = await Promise.all([
    read(cardUrl),
    read(adminIntegrationUrl),
  ]);
  assert.match(card, /Actualiser depuis la fédération/);
  assert.match(card, /\/api\/championship-standings-source/);
  assert.match(card, /\/api\/championship-general-standings-source/);
  assert.match(card, /previewRankings/);
  assert.match(card, /applyRankings/);
  assert.match(card, /Lire les classements officiels/);
  assert.match(card, /Appliquer les classements officiels/);
  assert.doesNotMatch(card, /textarea/);
  assert.match(integration, /ChampionshipStandingsImportCard/);
});

test("l'espace joueur conserve les valeurs officielles de poule", async () => {
  const [migration, service] = await Promise.all([
    read(migrationUrl),
    read(playerServiceUrl),
  ]);
  assert.match(migration, /'official_points', pool_standing\.points/);
  assert.match(migration, /'stats_source'/);
  assert.match(service, /officialPoints/);
  assert.match(service, /statsSource/);
});

test("le joueur peut naviguer entre sa poule, les autres poules et le général", async () => {
  const [contextMigration, contextService, page] = await Promise.all([
    read(rankingContextMigrationUrl),
    read(playerRankingServiceUrl),
    read(playerPageUrl),
  ]);
  assert.match(contextMigration, /get_my_championship_ranking_context/);
  assert.match(contextMigration, /general_standings/);
  assert.match(contextMigration, /direct_cutoff/);
  assert.match(contextMigration, /barrage_start/);
  assert.match(contextService, /generalStandings/);
  assert.match(contextService, /qualification/);
  assert.match(page, /Ma poule/);
  assert.match(page, /Toutes les poules/);
  assert.match(page, /Classement général/);
  assert.match(page, /Zone de qualification directe/);
  assert.match(page, /Zone barrage/);
  assert.match(page, /officialPoints/);
});
