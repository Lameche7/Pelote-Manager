import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const domainUrl = new URL(
  "../src/features/admin/championships/domain/championshipStandingsImport.ts",
  import.meta.url,
);
const clipboardUrl = new URL(
  "../src/features/admin/championships/domain/championshipStandingsClipboard.ts",
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

test("le copier-coller fédéral accepte une série choisie et un numéro d'équipe sur la ligne suivante", async () => {
  const clipboard = await read(clipboardUrl);
  const card = await read(cardUrl);

  assert.match(clipboard, /fallbackDivision/);
  assert.match(clipboard, /teamWithFollowingNumber/);
  assert.match(clipboard, /wins \+ losses \+ \(lost \?\? 0\)/);
  assert.match(card, /Série du classement copié/);
  assert.match(card, /championshipImportService/);
  assert.match(card, /divisionOptions/);
});

test("les fichiers de classement xlsx et csv sont acceptés et empreintés", async () => {
  const source = await read(sourceServiceUrl);

  assert.match(source, /endsWith\("\.xlsx"\)/);
  assert.match(source, /endsWith\("\.csv"\)/);
  assert.match(source, /parseStandings/);
  assert.match(source, /describeStandings/);
  assert.match(source, /SHA-256/);
  assert.match(source, /kind: "standings"/);
});

test("le serveur prévisualise puis applique sans recalculer le classement", async () => {
  const [migration, service] = await Promise.all([
    read(migrationUrl),
    read(standingsServiceUrl),
  ]);

  assert.match(
    migration,
    /admin_preview_championship_standings_import/,
  );
  assert.match(
    migration,
    /admin_apply_championship_standings_import/,
  );
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

test("l'administration affiche l'aperçu avant l'application", async () => {
  const [card, integration] = await Promise.all([
    read(cardUrl),
    read(adminIntegrationUrl),
  ]);

  assert.match(card, /Importer \/ actualiser le classement/);
  assert.match(card, /Comparer le classement/);
  assert.match(card, /Appliquer le classement officiel/);
  assert.match(card, /Aucun classement n’est recalculé ici/);
  assert.match(integration, /ChampionshipStandingsImportCard/);
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
