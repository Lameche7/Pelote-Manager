import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migration =
  "../supabase/migrations/20260822130000_public_tournament_final_bracket.sql";
const resultsService =
  "../src/features/tournaments/services/tournamentResultsService.ts";
const resultsBoard =
  "../src/features/tournaments/components/TournamentResultsBoard.tsx";
const adminControl =
  "../src/features/admin/tournaments/components/AdminTournamentFinalStageControl.tsx";
const fullPlanning =
  "../src/features/admin/tournaments/components/AdminTournamentFinalFullPlanning.tsx";

test("la vue publique reste sportive après le début réel du tournoi", async () => {
  const sql = await read(migration);

  assert.match(sql, /get_public_tournament_results/);
  assert.match(sql, /event\.publication_status = 'published'/);
  assert.match(sql, /result\.status = 'validated'/);
  assert.match(sql, /tournament_final_seeds/);
});

test("chaque série publique expose son tableau final complet", async () => {
  const [sql, service] = await Promise.all([
    read(migration),
    read(resultsService),
  ]);

  assert.match(sql, /'finals_generated'/);
  assert.match(sql, /'final_seeds'/);
  assert.match(sql, /'final_matches'/);
  assert.match(sql, /match\.phase = 'finals'/);
  assert.match(sql, /result\.winner_team_id/);
  assert.match(service, /finalsGenerated: boolean/);
  assert.match(service, /finalMatches: PublicTournamentFinalMatch\[\]/);
});

test("le public peut basculer entre tableau final et poules sans afficher les têtes de série", async () => {
  const board = await read(resultsBoard);

  assert.match(board, /Tableau final/);
  assert.match(board, /Poules & classements/);
  assert.match(board, /Tableau des phases finales/);
  assert.match(board, /Horaire à venir/);
  assert.doesNotMatch(board, /Voir les têtes de série/);
  assert.doesNotMatch(board, /N°\{match\.seed[AB]\}/);
  assert.match(board, /hasFinalStage \? "finals" : "pools"/);
});

test("un planning final global mène clairement à la publication des parties jouables", async () => {
  const [admin, planner] = await Promise.all([
    read(adminControl),
    read(fullPlanning),
  ]);

  assert.match(admin, /const planningReady =/);
  assert.match(admin, /some\(\(\{ match \}\) => !match\.planned\)/);
  assert.match(admin, /AdminTournamentFinalFullPlanning/);
  assert.match(admin, /Publier le tour et notifier les joueurs/);
  assert.match(planner, /Compléter automatiquement le planning/);
  assert.match(planner, /Modifier manuellement/);
  assert.match(planner, /À programmer/);
  assert.match(planner, /Tous les créneaux Finals sont proposés/);
});
