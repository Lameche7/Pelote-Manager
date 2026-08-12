import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260812151500_add_user_my_tournaments.sql";

test("Mes tournois est une projection personnelle sécurisée", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /create or replace function public\.get_my_tournaments\(\)/,
  );
  assert.match(migration, /security definer/);
  assert.match(migration, /current_profile_id uuid := auth\.uid\(\)/);
  assert.match(migration, /profile\.member_id/);
  assert.match(migration, /team\.submitted_by = current_profile_id/);
  assert.match(migration, /player\.member_id = current_member_id/);
  assert.match(migration, /team\.status in \('pending', 'accepted'\)/);
  assert.match(
    migration,
    /grant execute on function public\.get_my_tournaments\(\) to authenticated/,
  );
  assert.doesNotMatch(
    migration,
    /grant select on (?:table )?public\.tournament_(?:teams|matches|match_planning)/i,
  );
});

test("le partenaire licencié retrouve aussi le tournoi sans être le déclarant", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /team\.submitted_by = current_profile_id[\s\S]*or \([\s\S]*current_member_id is not null[\s\S]*player\.member_id = current_member_id/,
  );
});

test("le planning personnel reste caché jusqu'à sa publication", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /'planning_published'[\s\S]*'in_progress'[\s\S]*'completed'[\s\S]*'archived'/,
  );
  assert.match(migration, /public\.tournament_match_planning/);
  assert.match(migration, /public\.reservable_resources/);
  assert.match(migration, /opponent_players/);
  assert.match(migration, /pool_number/);
});

test("Mon espace active Mes tournois et sa route protégée", async () => {
  const [routes, router, dashboard, shell, page, service] = await Promise.all([
    read("../src/shared/config/routes.ts"),
    read("../src/app/router.tsx"),
    read(
      "../src/features/user-space/dashboard/pages/UserSpaceDashboardPage.tsx",
    ),
    read("../src/features/user-space/components/UserSpaceShell.tsx"),
    read("../src/features/user-space/tournaments/pages/MyTournamentsPage.tsx"),
    read(
      "../src/features/user-space/tournaments/services/myTournamentsService.ts",
    ),
  ]);

  assert.match(routes, /myTournaments:\s*"\/mon-espace\/tournois"/);
  assert.match(router, /ROUTES\.myTournaments/);
  assert.match(router, /<MyTournamentsPage \/>/);
  assert.match(
    dashboard,
    /title: "Mes tournois"[\s\S]*to: ROUTES\.myTournaments/,
  );
  assert.match(shell, /to=\{ROUTES\.myTournaments\}/);
  assert.match(page, /Mon équipe/);
  assert.match(page, /Prochaine partie/);
  assert.match(page, /Planning en préparation/);
  assert.match(page, /Toutes mes parties/);
  assert.match(service, /get_my_tournaments/);
});
