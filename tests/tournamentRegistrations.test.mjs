import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260807180000_add_tournament_registrations.sql";
const refinementMigrationPath =
  "../supabase/migrations/20260807190000_refine_tournament_registration_form.sql";
const datedAvailabilityMigrationPath =
  "../supabase/migrations/20260809143000_add_dated_tournament_availability.sql";
const adminDatedAvailabilityMigrationPath =
  "../supabase/migrations/20260810171500_admin_edit_tournament_dated_availability.sql";

test("les inscriptions créent des équipes privées, joueurs et disponibilités récurrentes historiques", async () => {
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

  assert.match(refinement, /get_my_tournament_registration_identity/);
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

test("les disponibilités sont des créneaux datés générés depuis la configuration admin", async () => {
  const migration = await read(datedAvailabilityMigrationPath);

  assert.match(
    migration,
    /create table if not exists public\.tournament_team_availability_slots/,
  );
  assert.match(
    migration,
    /minimum_availability_slots integer not null default 65/,
  );
  assert.match(
    migration,
    /minimum_weekend_availability_slots integer not null default 0/,
  );
  assert.match(migration, /slot_duration_minutes integer not null default 60/);
  assert.match(migration, /get_public_tournament_availability_grid/);
  assert.match(migration, /generate_series\(/);
  assert.match(migration, /public\.tournament_play_windows/);
  assert.match(migration, /date_series\.play_timestamp::date as play_date/);
  assert.match(migration, /Tournament availability minimum not reached/);
  assert.match(
    migration,
    /Tournament weekend availability minimum not reached/,
  );
  assert.match(migration, /Tournament availability slots are invalid/);
  assert.match(migration, /get_my_tournament_registration_v2/);
  assert.match(migration, /save_my_tournament_registration_v2/);
});

test("le service public utilise la grille datée et les RPC V2", async () => {
  const service = await read(
    "../src/features/tournaments/services/tournamentService.ts",
  );

  assert.match(service, /get_public_tournament_availability_grid/);
  assert.match(service, /availableSlots: mapAvailabilitySlots/);
  assert.match(service, /minimumAvailabilitySlots/);
  assert.match(service, /minimumWeekendAvailabilitySlots/);
  assert.match(service, /get_my_tournament_registration_v2/);
  assert.match(service, /save_my_tournament_registration_v2/);
  assert.match(service, /availability_slots/);
});

test("la grille d'inscription est datée, groupée par semaine et réutilisable dans l'admin", async () => {
  const grid = await read(
    "../src/features/tournaments/components/TournamentAvailabilityGrid.tsx",
  );

  assert.match(grid, /Semaine \{week\.week\} — \{week\.year\}/);
  assert.match(grid, /Créneaux cochés/);
  assert.match(grid, /Minimum requis/);
  assert.match(grid, /Week-end/);
  assert.match(grid, /Dupliquer cette semaine → suivante/);
  assert.match(grid, /toggleDay/);
  assert.match(grid, />Tout</);
  assert.match(grid, /type="checkbox"/);
  assert.match(grid, /variant = "registration"/);
  assert.match(grid, /Disponibilités datées de l’équipe/);
  assert.doesNotMatch(grid, /Si nécessaire/);
});

test("l'administrateur peut lire et enregistrer les créneaux datés avec les mêmes contrôles", async () => {
  const migration = await read(adminDatedAvailabilityMigrationPath);
  const service = await read(
    "../src/features/admin/tournaments/services/adminTournamentTeamService.ts",
  );
  const adminPage = await read(
    "../src/features/admin/tournaments/pages/AdminTournamentTeamsPage.tsx",
  );

  assert.match(migration, /admin_get_tournament_dated_availability/);
  assert.match(migration, /admin_get_tournament_team_dated_availability/);
  assert.match(migration, /admin_save_tournament_team_v2/);
  assert.match(migration, /Tournament availability minimum not reached/);
  assert.match(
    migration,
    /Tournament weekend availability minimum not reached/,
  );
  assert.match(migration, /Tournament availability slots are invalid/);
  assert.match(migration, /team_availability_slots_saved_by_admin/);
  assert.match(migration, /has_club_permission[\s\S]*tournaments\.manage/);
  assert.match(service, /admin_get_tournament_team_dated_availability/);
  assert.match(service, /admin_save_tournament_team_v2/);
  assert.match(service, /availability_slots/);
  assert.match(adminPage, /TournamentAvailabilityGrid/);
  assert.match(adminPage, /variant="admin"/);
  assert.match(adminPage, /availabilitySlots/);
  assert.match(adminPage, /Enregistrer l’équipe et ses disponibilités/);
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
  assert.match(registrationForm, /TournamentAvailabilityGrid/);
  assert.match(registrationForm, /availabilityMinimumReached/);
  assert.match(registrationForm, /searchPartnerMembers/);
  assert.match(registrationForm, /Récupéré depuis la fiche licencié/);
  assert.match(adminPage, /Ajouter une équipe/);
  assert.match(adminPage, /Modifier/);
  assert.match(adminPage, /Retirer/);
});
