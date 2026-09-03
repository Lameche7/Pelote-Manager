import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260903170000_external_identity_self_claim.sql",
  import.meta.url,
);
const serviceUrl = new URL(
  "../src/features/auth/services/externalParticipationService.ts",
  import.meta.url,
);
const authServiceUrl = new URL(
  "../src/infrastructure/auth/authService.ts",
  import.meta.url,
);
const registerPageUrl = new URL(
  "../src/features/auth/pages/RegisterPage.tsx",
  import.meta.url,
);
const loginPageUrl = new URL(
  "../src/features/auth/pages/LoginPage.tsx",
  import.meta.url,
);
const myTournamentsMigrationUrl = new URL(
  "../supabase/migrations/20260822102000_expose_tournament_final_matches.sql",
  import.meta.url,
);

test("la recherche publique utilise seulement nom prénom et contexte sportif", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const start = migration.indexOf(
    "create or replace function public.find_external_participation_candidates",
  );
  const end = migration.indexOf(
    "create or replace function public.sync_verified_external_identity_to_tournament_players",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const block = migration.slice(start, end);

  assert.match(block, /identity\.status = 'unmatched'/);
  assert.match(block, /identity\.profile_id is null/);
  assert.match(block, /identity\.member_id is null/);
  assert.match(
    block,
    /identity\.first_name_normalized = normalized_first_name/,
  );
  assert.match(block, /identity\.last_name_normalized = normalized_last_name/);
  assert.match(block, /'tournamentName'/);
  assert.match(block, /'seriesName'/);
  assert.match(block, /'partnerFirstName'/);
  assert.doesNotMatch(block, /'phone'\s*,/);
  assert.doesNotMatch(block, /'email'\s*,/);
  assert.doesNotMatch(block, /'source'\s*,/);
  assert.match(
    block,
    /grant execute on function public\.find_external_participation_candidates\(text, text\)[\s\S]*to anon, authenticated/,
  );
});

test("la confirmation joueur rattache le profil sans fabriquer de licence", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const start = migration.indexOf(
    "create or replace function public.claim_external_participation",
  );
  const end = migration.indexOf(
    "create or replace function public.sync_profile_to_external_identities",
    start,
  );
  assert.ok(start >= 0 && end > start);
  const block = migration.slice(start, end);

  assert.match(block, /current_profile_id uuid := auth\.uid\(\)/);
  assert.match(block, /target_identity\.status <> 'unmatched'/);
  assert.match(block, /target_identity\.first_name_normalized/);
  assert.match(block, /target_identity\.last_name_normalized/);
  assert.match(block, /profile_id = current_profile\.id/);
  assert.match(block, /member_id = current_profile\.member_id/);
  assert.match(block, /verification_method = 'self_name_confirmation'/);
  assert.match(block, /verified_by = current_profile\.id/);
  assert.doesNotMatch(block, /insert into public\.club_members/);
});

test("les coordonnées importées ne servent jamais à confirmer le compte", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  const claimStart = migration.indexOf(
    "create or replace function public.claim_external_participation",
  );
  const claimEnd = migration.indexOf(
    "create or replace function public.sync_profile_to_external_identities",
    claimStart,
  );
  const claim = migration.slice(claimStart, claimEnd);

  assert.doesNotMatch(claim, /phone_normalized/);
  assert.doesNotMatch(claim, /target_identity\.phone/);
  assert.doesNotMatch(claim, /target_identity\.email/);
  assert.match(
    migration,
    /Les emails importés ne participent volontairement pas[\s\S]*à ce contrôle/,
  );
});

test("le compte récupère les accès joueur déjà utilisés par Mes tournois", async () => {
  const [migration, myTournaments] = await Promise.all([
    readFile(migrationUrl, "utf8"),
    readFile(myTournamentsMigrationUrl, "utf8"),
  ]);

  assert.match(
    migration,
    /email = case[\s\S]*target_profile\.email[\s\S]*where player\.external_identity_id = new\.id/,
  );
  assert.match(
    myTournaments,
    /lower\(btrim\(player\.email\)\) = lower\(btrim\(current_profile_email\)\)/,
  );
});

test("une licence liée plus tard enrichit le même compte et la même identité externe", async () => {
  const migration = await readFile(migrationUrl, "utf8");
  assert.match(migration, /sync_profile_to_external_identities/);
  assert.match(migration, /identity\.profile_id = new\.id/);
  assert.match(migration, /member_id = new\.member_id/);
  assert.match(migration, /identity\.member_id = new\.member_id/);
  assert.doesNotMatch(
    migration,
    /create or replace function public\.admin_link_errebot_identity_candidate/,
  );
});

test("la création de compte propose la participation avant les identifiants", async () => {
  const [service, authService, registerPage, loginPage] = await Promise.all([
    readFile(serviceUrl, "utf8"),
    readFile(authServiceUrl, "utf8"),
    readFile(registerPageUrl, "utf8"),
    readFile(loginPageUrl, "utf8"),
  ]);

  assert.match(service, /find_external_participation_candidates/);
  assert.match(service, /claim_external_participation/);
  assert.match(registerPage, /Quelle est votre situation/);
  assert.match(registerPage, /Créer mon compte Pelote Manager/);
  assert.match(registerPage, /Il semblerait que vous participiez au/);
  assert.match(registerPage, /Oui, c’est bien moi/);
  assert.match(registerPage, /Aucune ne me correspond/);
  assert.doesNotMatch(registerPage, /Je ne suis pas licencié/);
  assert.match(authService, /pending_external_identity_id/);
  assert.match(authService, /finalizePendingExternalParticipation/);
  assert.match(loginPage, /finalizePendingExternalParticipation/);
});
