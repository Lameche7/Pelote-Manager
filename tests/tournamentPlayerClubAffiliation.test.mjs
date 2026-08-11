import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildClubAffiliationMap,
  generateOptimizedPools,
  getPoolClubMetric,
  getSeriesClubMetric,
} from "../.test-dist/src/features/tournaments/domain/poolEngine.js";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const deterministicRandom = () => {
  let state = 0x12345678;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
};

test("le moteur repartit les clubs avant d optimiser les disponibilites", () => {
  const clubs = ["A", "A", "B", "B", "C", "C", "D", "D"];
  const teams = clubs.map((clubName, index) => ({
    id: `team-${index + 1}`,
    seriesId: "series-1",
    clubNames: [clubName],
  }));

  const pools = generateOptimizedPools({
    series: [{ id: "series-1", name: "Série 1", teams }],
    pairings: [],
    random: deterministicRandom(),
    iterationsPerSeries: 2500,
  });
  const metric = getSeriesClubMetric(pools, buildClubAffiliationMap(teams));

  assert.equal(pools.length, 2);
  assert.equal(metric.maxTeamsPerClub, 1);
  assert.equal(metric.duplicatePairCount, 0);
});

test("une equipe mixte represente bien ses deux clubs", () => {
  const teams = [
    { id: "mixte", seriesId: "s1", clubNames: ["Club A", "Club B"] },
    { id: "b", seriesId: "s1", clubNames: ["Club B"] },
    { id: "c", seriesId: "s1", clubNames: ["Club C"] },
    { id: "d", seriesId: "s1", clubNames: ["Club D"] },
  ];
  const affiliations = buildClubAffiliationMap(teams);
  const metric = getPoolClubMetric(
    {
      key: "p1",
      seriesId: "s1",
      displayOrder: 0,
      targetSize: 4,
      teams: teams.map((team) => ({ teamId: team.id })),
    },
    affiliations,
  );

  assert.equal(metric.maxTeamsPerClub, 2);
  assert.equal(metric.duplicatePairCount, 1);
  assert.equal(metric.representedClubCount, 4);
});

test("la migration fige le club sur le joueur et conserve les anciens moteurs", async () => {
  const migration = await read(
    "../supabase/migrations/20260811123000_add_tournament_player_clubs.sql",
  );

  assert.match(
    migration,
    /alter table public\.tournament_team_players[\s\S]*club_name text not null default ''/,
  );
  assert.match(migration, /Tournament player clubs are incomplete/);
  assert.match(migration, /get_my_tournament_registration_identity_v2/);
  assert.match(migration, /get_my_tournament_registration_v3/);
  assert.match(migration, /save_my_tournament_registration_v3/);
  assert.match(migration, /admin_save_tournament_team_v3/);
  assert.match(migration, /admin_get_tournament_pool_workspace_v2/);
  assert.match(
    migration,
    /generate_tournament_test_data_before_club_affiliation/,
  );
  assert.match(migration, /Club test /);
});

test("les interfaces demandent et affichent le club", async () => {
  const [registrationForm, adminTeamsPage, poolPage, service] =
    await Promise.all([
      read(
        "../src/features/tournaments/components/TournamentRegistrationForm.tsx",
      ),
      read(
        "../src/features/admin/tournaments/pages/AdminTournamentTeamsPage.tsx",
      ),
      read(
        "../src/features/admin/tournaments/pages/AdminTournamentPoolsPage.tsx",
      ),
      read("../src/features/tournaments/services/tournamentService.ts"),
    ]);

  assert.match(registrationForm, /Votre club/);
  assert.match(registrationForm, /Club du partenaire/);
  assert.match(adminTeamsPage, />Club</);
  assert.match(poolPage, /Clubs parfaitement répartis/);
  assert.match(poolPage, /clubNames: team\.clubNames/);
  assert.match(service, /get_public_tournament_v2/);
  assert.match(service, /save_my_tournament_registration_v3/);
});
