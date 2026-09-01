import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260814180000_add_tournament_ranking_engine.sql";

test("le Ranking Engine ne consomme que les résultats validés", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /result\.status = 'validated'/);
  assert.match(migration, /team_a_ranking_points/);
  assert.match(migration, /team_b_ranking_points/);
  assert.match(migration, /team_a_points/);
  assert.match(migration, /team_b_points/);
});

test("le classement applique tous les départages sportifs dans l'ordre", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /rules\.ranking_mode = 'points_per_match'/);
  assert.match(
    migration,
    /rules\.goal_average_mode = 'point_difference_per_match'/,
  );
  assert.match(migration, /head_to_head_wins/);
  assert.match(migration, /points_for_per_match/);
  assert.match(migration, /win_percentage/);
  assert.match(
    migration,
    /dense_rank\(\) over \([\s\S]*ranking_value desc,[\s\S]*goal_average_value desc,[\s\S]*head_to_head_wins desc,[\s\S]*points_for_per_match desc,[\s\S]*win_percentage desc/,
  );
  assert.match(migration, /'is_tied', ranked\.tie_count > 1/);
});

test("une projection unique alimente le public et l'administration", async () => {
  const [migration, service, publicPage, adminPage, component] =
    await Promise.all([
      read(migrationPath),
      read("../src/features/tournaments/services/tournamentRankingService.ts"),
      read("../src/features/tournaments/pages/TournamentDetailPage.tsx"),
      read(
        "../src/features/admin/tournaments/pages/AdminTournamentResultsPage.tsx",
      ),
      read("../src/features/tournaments/components/TournamentRankings.tsx"),
    ]);

  assert.match(
    migration,
    /create or replace function public\.get_tournament_rankings/,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_tournament_rankings\(uuid\)[\s\S]*to anon, authenticated/,
  );
  assert.match(service, /supabase\.rpc\("get_tournament_rankings"/);
  assert.match(service, /headToHeadWins/);
  assert.match(service, /pointsForPerMatch/);
  assert.match(service, /winPercentage/);
  assert.match(publicPage, /tournamentRankingService\.get/);
  assert.match(
    publicPage,
    /<TournamentRankings\s+rankings=\{rankings\}\s+generalRankings=\{generalRankings\}/,
  );
  assert.match(adminPage, /tournamentRankingService\.get/);
  assert.match(
    adminPage,
    /<TournamentRankings rankings=\{selectedRankings\} compact/,
  );
  assert.match(component, /Résultats validés uniquement/);
  assert.match(component, /confrontation directe/);
  assert.match(component, /points marqués par partie/);
  assert.match(component, /pourcentage de victoires/);
});
