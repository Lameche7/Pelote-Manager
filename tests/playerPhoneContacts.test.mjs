import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) => readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("les téléphones restent limités aux participants des compétitions actives", async () => {
  const [migration, registrationContactMigration] = await Promise.all([
    read("supabase/migrations/20260916170000_add_player_phone_contacts.sql"),
    read(
      "supabase/migrations/20260918090000_expose_tournament_registration_phone_contacts.sql",
    ),
  ]);
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
  assert.match(
    registrationContactMigration,
    /tournament\.status not in \('completed', 'archived', 'cancelled'\)/,
  );
  assert.match(
    registrationContactMigration,
    /nullif\(btrim\(player\.phone\), ''\)/,
  );
  assert.match(
    registrationContactMigration,
    /'contact_kind', contact\.contact_kind/,
  );
  assert.match(registrationContactMigration, /then 'registration'/);
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
  assert.match(
    tournamentService,
    /phoneKind: "verified" \| "registration" \| null/,
  );
  assert.match(tournamentService, /contact\.contact_kind === "verified"/);
  assert.match(tournamentPage, /buildPhoneContacts/);
  assert.match(tournamentPage, /Contact d’inscription/);
  assert.match(tournamentPage, /Contact d’équipe/);
  assert.match(tournamentPage, /my-tournaments__team-contacts/);
  assert.match(tournamentPage, /my-tournaments__opponent-contacts/);
  assert.match(tournamentPage, /phoneHref\(contact\.phone\)/);

  assert.doesNotMatch(championshipService, /get_my_championship_player_contacts/);
  assert.match(championshipService, /opponentResponsibleName/);
  assert.match(championshipService, /opponentResponsiblePhone/);
  assert.match(championshipPage, /my-championships__opponent-responsible/);
  assert.match(championshipPage, /phoneHref\(match\.opponentResponsiblePhone\)/);
});
