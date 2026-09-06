import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260906193000_add_championship_result_settings.sql",
  import.meta.url,
);
const adminPageUrl = new URL(
  "../src/features/admin/championships/components/ChampionshipResultSettingsCard.tsx",
  import.meta.url,
);
const playerPageUrl = new URL(
  "../src/features/user-space/championships/pages/MyChampionshipsPage.tsx",
  import.meta.url,
);
const playerSettingsServiceUrl = new URL(
  "../src/features/user-space/championships/services/myChampionshipResultSettingsService.ts",
  import.meta.url,
);

const read = (url) => readFile(url, "utf8");

test("le championnat porte un format de score manuel sans dépendre de la discipline", async () => {
  const sql = await read(migrationUrl);

  assert.match(sql, /add column result_input_mode text/);
  assert.match(sql, /add column result_winning_score integer/);
  assert.match(sql, /result_input_mode in \('points', 'sets'\)/);
  assert.doesNotMatch(sql, /specialty[\s\S]*(points|sets)/i);
});

test("seul un administrateur autorisé peut modifier le format", async () => {
  const sql = await read(migrationUrl);

  assert.match(
    sql,
    /create or replace function public\.admin_update_championship_result_settings/,
  );
  assert.match(sql, /championship_club_can_manage\(target_id, target_club_id\)/);
  assert.match(sql, /'result_settings\.updated'/);
});

test("la proposition joueur doit respecter exactement le score gagnant configuré", async () => {
  const sql = await read(migrationUrl);

  assert.match(sql, /Result input settings not configured/);
  assert.match(
    sql,
    /greatest\(target_score_mine, target_score_opponent\) <> result_winning_score/,
  );
  assert.match(
    sql,
    /least\(target_score_mine, target_score_opponent\) >= result_winning_score/,
  );
  assert.match(sql, /target_score_mine = target_score_opponent/);
});

test("l’administration propose les deux modes simples demandés", async () => {
  const page = await read(adminPageUrl);

  assert.match(page, /Score en points/);
  assert.match(page, /Score en manches/);
  assert.match(page, /Ex\. 35 ou 40 selon le championnat/);
  assert.match(page, /Ex\. 2 pour une partie gagnée en 2 manches/);
  assert.match(page, /Activer cette saisie/);
});

test("l’espace joueur charge le réglage et adapte les libellés", async () => {
  const [page, service] = await Promise.all([
    read(playerPageUrl),
    read(playerSettingsServiceUrl),
  ]);

  assert.match(service, /get_my_championship_result_settings/);
  assert.match(page, /Nos manches/);
  assert.match(page, /Nos points/);
  assert.match(page, /Saisie du résultat non paramétrée/);
  assert.match(page, /Format attendu : premier à/);
});
