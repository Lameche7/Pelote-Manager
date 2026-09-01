import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260901150000_expose_tournament_publication_conflict_source.sql",
    import.meta.url,
  ),
  "utf8",
);
const service = readFileSync(
  new URL(
    "../src/features/admin/tournaments/services/adminTournamentPublicationService.ts",
    import.meta.url,
  ),
  "utf8",
);
const page = readFileSync(
  new URL(
    "../src/features/admin/tournaments/pages/AdminTournamentPublicationPage.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("le preview identifie seulement un tournoi Pelote Manager à l'origine du conflit", () => {
  assert.match(migration, /conflict_tournament_id/);
  assert.match(migration, /conflict_tournament_name/);
  assert.match(migration, /conflict_tournament_status/);
  assert.match(migration, /tournament_match_events/);
  assert.match(migration, /calendar_occupation_id = occupation\.id/);
  assert.match(migration, /conflicting_tournament\.club_id = target_club_id/);
  assert.match(migration, /conflicting_tournament\.id <> target_tournament\.id/);
});

test("le service mappe la source tournoi sans rendre les autres conflits actionnables", () => {
  assert.match(service, /conflictTournamentId: string \| null/);
  assert.match(service, /conflictTournamentName: string \| null/);
  assert.match(service, /conflictTournamentStatus: TournamentStatus \| null/);
});

test("l'écran permet de retirer directement un tournoi publié en conflit", () => {
  assert.match(page, /resolveConflictingTournament/);
  assert.match(page, /conflictTournamentStatus ===\s*"planning_published"/);
  assert.match(page, /Retirer « \{conflict\.conflictTournamentName\} » du/);
  assert.match(
    page,
    /adminTournamentPublicationService\.unpublish\(tournamentId\)/,
  );
});
