import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("les téléphones restent limités aux participants des compétitions actives", async () => {
  const migration = await read(
    "supabase/migrations/20260916170000_add_player_phone_contacts.sql",
  );
  assert.match(migration, /get_my_tournament_player_contacts/);
  assert.match(migration, /get_my_championship_player_contacts/);
  assert.match(
    migration,
    /tournament\.status not in \('completed', 'archived', 'cancelled'\)/,
  );
  assert.match(
    migration,
    /championship\.status in \('preparation', 'active'\)/,
  );
  assert.match(migration, /identity\.status = 'verified'/);
  assert.match(migration, /player\.external_identity_id is null/);
});

test("Mes tournois et Mes championnats affichent les contacts disponibles", async () => {
  const [
    tournamentService,
    tournamentPage,
    championshipService,
    championshipPage,
  ] = await Promise.all([
    read(
      "src/features/user-space/tournaments/services/myTournamentsService.ts",
    ),
    read("src/features/user-space/tournaments/pages/MyTournamentsPage.tsx"),
    read(
      "src/features/user-space/championships/services/myChampionshipsService.ts",
    ),
    read("src/features/user-space/championships/pages/MyChampionshipsPage.tsx"),
  ]);

  assert.match(tournamentService, /get_my_tournament_player_contacts/);
  assert.match(tournamentService, /phone: string \| null/);
  assert.match(tournamentPage, /my-tournaments__opponent-contacts/);
  assert.match(tournamentPage, /phoneHref\(player\.phone/);

  assert.match(championshipService, /get_my_championship_player_contacts/);
  assert.match(championshipService, /opponentContacts/);
  assert.match(championshipPage, /my-championships__opponent-contacts/);
  assert.match(championshipPage, /phoneHref\(contact\.phone\)/);
});
