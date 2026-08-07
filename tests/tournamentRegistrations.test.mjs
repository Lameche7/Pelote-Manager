import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260807180000_add_tournament_registrations.sql";
const refinementMigrationPath =
  "../supabase/migrations/20260807190000_refine_tournament_registration_form.sql";

test("les inscriptions créent des équipes privées, joueurs et disponibilités récurrentes", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /create table if not exists public\.tournament_teams/,
  );
  assert.match(
    migration,
    /create table if not exists public\.tournament_team_players/,
  );
  assert.match(
    migration,
    /create table if not exists public\.tournament_team_availability_rules/,
  );
  assert.match(
    migration,
    /alter table public\.tournament_teams enable row level security/,
  );
  assert.match(
    migration,
    /revoke all on table public\.tournament_teams from public, anon, authenticated/,
  );
  assert.match(migration, /'unavailable'[\s\S]*'preferred'[\s\S]*'possible'/);
});

test("une équipe de pala contient exactement un Avant et un Arrière", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /jsonb_array_length\(coalesce\(players, '\[\]'::jsonb\)\) <> 2/,
  );
  assert.match(migration, /A tournament team must contain exactly two players/);
  assert.match(
    migration,
    /A team must contain one front player and one back player/,
  );
  assert.match(
    migration,
    /A player can only belong to one active team per tournament/,
  );
});

test("l'inscription utilisateur exige authentification, fenêtre ouverte et capacité", async () => {
  const migration = await read(migrationPath);
  const start = migration.indexOf(
    "create or replace function public.save_my_tournament_registration",
  );
  const end = migration.indexOf(
    "create or replace function public.withdraw_my_tournament_registration",
  );
  const registration = migration.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(registration, /target_user_id uuid := auth\.uid\(\)/);
  assert.match(registration, /tournament_registration_is_open/);
  assert.match(registration, /tournament_series_has_capacity/);
  assert.match(registration, /status,[\s\S]*'pending'/);
  assert.match(
    migration,
    /grant execute on function public\.save_my_tournament_registration\(uuid, jsonb\) to authenticated/,
  );
});

test("la projection publique masque les coordonnées et ne montre que les équipes validées", async () => {
  const migration = await read(migrationPath);
  const start = migration.indexOf(
    "create or replace function public.get_public_tournament",
  );
  const end = migration.indexOf(
    "create or replace function public.get_my_tournament_registration",
  );
  const projection = migration.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(projection, /team\.status = 'accepted'/);
  assert.match(projection, /'first_name', player\.first_name/);
  assert.match(projection, /'last_name', player\.last_name/);
  assert.match(projection, /'role', player\.role/);
  assert.doesNotMatch(projection, /contact_email|contact_phone/);
  assert.doesNotMatch(
    projection,
    /'email', player\.email|'phone', player\.phone/,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_public_tournament\(uuid\) to anon, authenticated/,
  );
});

test("l'administrateur peut gérer les équipes après clôture mais pas après les poules", async () => {
  const migration = await read(migrationPath);
  const start = migration.indexOf(
    "create or replace function public.admin_save_tournament_team",
  );
  const end = migration.indexOf(
    "create or replace function public.admin_set_tournament_team_status",
  );
  const adminSave = migration.slice(start, end);

  assert.ok(start >= 0 && end > start);
  assert.match(adminSave, /'registrations_closed'/);
  assert.match(adminSave, /Tournament teams are locked at this stage/);
  assert.doesNotMatch(adminSave, /'pools_generated'/);
  assert.match(migration, /'team_added_by_admin'/);
  assert.match(migration, /'team_updated_by_admin'/);
});

test("les coordonnées licenciés sont prioritaires et les contacts manquants deviennent obligatoires", async () => {
  const refinement = await read(refinementMigrationPath);

  assert.match(
    refinement,
    /get_my_tournament_registration_identity/,
  );
  assert.match(refinement, /search_tournament_partner_members/);
  assert.match(refinement, /current_member\.email/);
  assert.match(refinement, /current_member\.phone/);
  assert.match(refinement, /partner_member\.email/);
  assert.match(refinement, /partner_member\.phone/);
  assert.match(refinement, /Tournament player contacts are incomplete/);
  assert.match(refinement, /partner_member_id/);
  assert.match(
    refinement,
    /grant execute on function public\.search_tournament_partner_members\(uuid, text\) to authenticated/,
  );
});

test("les disponibilités utilisateur reprennent les plages du tournoi et sont contrôlées côté serveur", async () => {
  const refinement = await read(refinementMigrationPath);

  assert.match(refinement, /'play_windows'/);
  assert.match(refinement, /public\.tournament_play_windows/);
  assert.match(refinement, /play_window\.weekday = availability_weekday/);
  assert.match(refinement, /play_window\.opens_at = availability_starts_at/);
  assert.match(refinement, /play_window\.closes_at = availability_ends_at/);
});

test("les pages Tournois exposent consultation publique, inscription compacte et gestion admin", async () => {
  const [
    router,
    navigation,
    layout,
    publicPage,
    detailPage,
    registrationForm,
    adminPage,
  ] = await Promise.all([
    read("../src/app/router.tsx"),
    read("../src/features/admin/config/adminPermissions.ts"),
    read("../src/app/layouts/MainLayout.tsx"),
    read("../src/features/tournaments/pages/TournamentsPage.tsx"),
    read("../src/features/tournaments/pages/TournamentDetailPage.tsx"),
    read(
      "../src/features/tournaments/components/TournamentRegistrationForm.tsx",
    ),
    read(
      "../src/features/admin/tournaments/pages/AdminTournamentTeamsPage.tsx",
    ),
  ]);

  assert.match(router, /TournamentsPage/);
  assert.match(router, /TournamentDetailPage/);
  assert.match(router, /AdminTournamentTeamsPage/);
  assert.match(layout, />\s*Tournois\s*</);
  assert.match(navigation, /Équipes & inscriptions/);
  assert.match(publicPage, /Voir le tournoi/);
  assert.match(detailPage, /Se connecter pour inscrire une équipe/);
  assert.match(detailPage, /public-tournament-panel--teams/);
  assert.match(registrationForm, /Poste du partenaire/);
  assert.match(registrationForm, /type="checkbox"/);
  assert.match(registrationForm, /Disponible/);
  assert.match(registrationForm, /Si nécessaire/);
  assert.match(registrationForm, /searchPartnerMembers/);
  assert.match(registrationForm, /Récupéré depuis la fiche licencié/);
  assert.match(adminPage, /Ajouter une équipe/);
  assert.match(adminPage, /Valider/);
  assert.match(adminPage, /Refuser/);
  assert.match(adminPage, /Retirer/);
});
