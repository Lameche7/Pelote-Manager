import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const correctiveMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260901164500_keep_errebot_results_external.sql",
    import.meta.url,
  ),
  "utf8",
);
const detailPage = readFileSync(
  new URL(
    "../src/features/tournaments/pages/TournamentDetailPage.tsx",
    import.meta.url,
  ),
  "utf8",
);
const rankings = readFileSync(
  new URL(
    "../src/features/tournaments/components/TournamentRankings.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("un import Errebot ne transforme jamais ses scores source en résultats natifs", () => {
  assert.match(
    correctiveMigration,
    /Les scores .* restent uniquement de[\s\S]*provenance/i,
  );
  assert.match(
    correctiveMigration,
    /delete from public\.tournament_match_results/,
  );
  assert.match(correctiveMigration, /result\.submitted_by is null/);
  assert.match(correctiveMigration, /result\.validated_by is null/);
  assert.match(
    correctiveMigration,
    /drop function if exists public\.sync_errebot_single_game_results/,
  );
  assert.doesNotMatch(correctiveMigration, /promotedResultCount/);
});

test("la page publique charge le classement général avant le début du tournoi", () => {
  assert.match(
    detailPage,
    /tournamentGeneralRankingService\.get\(tournamentId\)/,
  );
  assert.match(detailPage, /generalRankings=\{generalRankings\}/);
  assert.ok(
    detailPage.indexOf("<TournamentRankings") <
      detailPage.indexOf("<h2>Équipes inscrites<\/h2>"),
  );
});

test("les classements pré-tournoi montrent le général de série puis les poules", () => {
  assert.match(rankings, /Classement général/);
  assert.match(rankings, /Poule \{pool\.number\}/);
  assert.match(
    rankings,
    /Avant le premier résultat, toutes les équipes démarrent à zéro/,
  );
});
