import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/platform/migrations/20260804010000_create_platform_registry.sql",
  "utf8",
);
const provisioningMigration = fs.readFileSync(
  "supabase/platform/migrations/20260804020000_add_platform_provisioning_jobs.sql",
  "utf8",
);
const bootstrap = fs.readFileSync(
  "supabase/platform/bootstrap/01_attach_first_platform_admin.sql",
  "utf8",
);
const platformReadme = fs.readFileSync("supabase/platform/README.md", "utf8");
const architecture = fs.readFileSync(
  "docs/architecture/PLATFORM_PROVISIONING_AND_NETWORK.md",
  "utf8",
);
const envExample = fs.readFileSync(".env.example", "utf8");
const platformClient = fs.readFileSync(
  "src/infrastructure/platform/platformClient.ts",
  "utf8",
);
const router = fs.readFileSync("src/app/router.tsx", "utf8");
const routes = fs.readFileSync("src/shared/config/routes.ts", "utf8");
const registryService = fs.readFileSync(
  "src/features/platform/services/platformRegistryService.ts",
  "utf8",
);
const dashboard = fs.readFileSync(
  "src/features/platform/pages/PlatformDashboardPage.tsx",
  "utf8",
);

test("le registre central reste séparé des migrations et données de clubs", () => {
  assert.match(platformReadme, /projet Supabase distinct/);
  assert.match(platformReadme, /ne contient jamais/);
  assert.match(platformReadme, /licenciés/);
  assert.match(platformReadme, /réservations/);
  assert.doesNotMatch(migration, /public\.club_members\b/);
  assert.doesNotMatch(migration, /public\.reservations\b/);
  assert.doesNotMatch(migration, /public\.payments\b/);
  assert.doesNotMatch(provisioningMigration, /public\.club_members\b/);
  assert.doesNotMatch(provisioningMigration, /public\.reservations\b/);
});

test("seuls les super administrateurs actifs accèdent au registre", () => {
  assert.match(migration, /create table if not exists public\.platform_admins/);
  assert.match(migration, /create table if not exists public\.platform_clubs/);
  assert.match(
    migration,
    /create table if not exists public\.platform_audit_log/,
  );
  assert.match(migration, /enable row level security/g);
  assert.match(migration, /is_platform_admin\(\)/);
  assert.match(migration, /where admins\.user_id = auth\.uid\(\)/);
  assert.match(migration, /and admins\.is_active/);
});

test("toutes les commandes de plateforme contrôlent et auditent l’appelant", () => {
  for (const functionName of [
    "platform_list_clubs",
    "platform_create_club",
    "platform_update_club_status",
  ]) {
    const start = migration.indexOf(`function public.${functionName}`);
    assert.notEqual(start, -1, `${functionName} doit exister`);
    const end = migration.indexOf("$$;", start);
    const body = migration.slice(start, end + 3);
    assert.match(body, /public\.is_platform_admin\(\)/);
  }

  assert.match(migration, /'club\.created'/);
  assert.match(migration, /'club\.status_updated'/);
  assert.match(migration, /revoke all on function public\.platform_list_clubs/);
  assert.match(
    migration,
    /grant execute on function public\.platform_list_clubs/,
  );
  assert.doesNotMatch(migration, /as \$\$;/);
});

test("le premier propriétaire est rattaché uniquement par son compte central", () => {
  assert.match(bootstrap, /from auth\.users/);
  assert.match(bootstrap, /insert into public\.platform_admins/);
  assert.match(bootstrap, /A_REMPLACER_PAR_EMAIL_SUPER_ADMIN/);
  assert.doesNotMatch(bootstrap, /club_memberships/);
});

test("le navigateur utilise un client central distinct et sans secret serveur", () => {
  for (const variable of [
    "VITE_PLATFORM_SUPABASE_URL",
    "VITE_PLATFORM_SUPABASE_ANON_KEY",
  ]) {
    assert.match(envExample, new RegExp(variable));
    assert.match(platformClient, new RegExp(variable));
  }

  assert.match(platformClient, /pelote-manager-platform-auth/);
  assert.doesNotMatch(platformClient, /service_role/i);
  assert.doesNotMatch(envExample, /SERVICE_ROLE/);
});

test("l’espace super admin est séparé des routes administrateur de club", () => {
  assert.match(routes, /platform: "\/super-admin"/);
  assert.match(routes, /platformLogin: "\/super-admin\/connexion"/);
  assert.match(router, /PlatformProviderLayout/);
  assert.match(router, /PlatformProtectedRoute/);
  assert.match(router, /PlatformDashboardPage/);
  assert.match(router, /PlatformLoginPage/);
});

test("l’interface ne manipule que le registre commercial et technique", () => {
  assert.match(registryService, /platform_list_clubs/);
  assert.match(registryService, /platform_create_club/);
  assert.match(registryService, /platform_update_club_status/);
  assert.match(dashboard, /Aucune instance ni donnée métier/);
  assert.doesNotMatch(registryService, /club_members/);
  assert.doesNotMatch(registryService, /reservations/);
});

test("une seule demande de provisionnement ouverte est autorisée par club", () => {
  assert.match(
    provisioningMigration,
    /create table if not exists public\.platform_provisioning_jobs/,
  );
  assert.match(
    provisioningMigration,
    /create unique index if not exists platform_provisioning_one_open_job_idx/,
  );
  assert.match(
    provisioningMigration,
    /where status in \('pending', 'running', 'waiting_external'\)/,
  );
  assert.match(provisioningMigration, /platform_request_provisioning/);
  assert.match(provisioningMigration, /existing_job_id/);
  assert.match(provisioningMigration, /'provisioning\.requested'/);
});

test("le navigateur prépare et suit le provisionnement sans exécuter les secrets", () => {
  assert.match(registryService, /platform_list_provisioning_jobs/);
  assert.match(registryService, /platform_request_provisioning/);
  assert.match(dashboard, /Préparer l’instance/);
  assert.match(dashboard, /futur service sécurisé/);
  assert.doesNotMatch(registryService, /service_role/i);
  assert.doesNotMatch(dashboard, /service_role/i);
  assert.doesNotMatch(dashboard, /access_token|personal_access_token/i);
});

test("seul le service serveur peut avancer réellement le provisionnement", () => {
  assert.match(
    provisioningMigration,
    /function public\.platform_worker_update_provisioning/,
  );
  assert.match(provisioningMigration, /auth\.role\(\) <> 'service_role'/);
  assert.match(
    provisioningMigration,
    /grant execute on function public\.platform_worker_update_provisioning[\s\S]*to service_role/,
  );
  assert.doesNotMatch(
    provisioningMigration,
    /grant execute on function public\.platform_worker_update_provisioning[\s\S]{0,200}to authenticated/,
  );
  assert.match(provisioningMigration, /'provisioning\.updated'/);
  assert.match(provisioningMigration, /actor_kind/);
  assert.match(provisioningMigration, /'system'/);
});

test("un club ne peut être activé qu’après installation technique", () => {
  assert.match(
    provisioningMigration,
    /Le club ne peut pas être activé avant la fin du provisionnement/,
  );
  assert.match(
    provisioningMigration,
    /target_club\.supabase_project_ref is null/,
  );
  assert.match(provisioningMigration, /target_club\.deployment_url is null/);
  assert.match(provisioningMigration, /target_club\.current_version is null/);
  assert.match(
    provisioningMigration,
    /when new_status = 'completed' and status = 'provisioning' then 'trial'/,
  );
});

test("le réseau de tournois futur reste séparé du registre commercial", () => {
  assert.match(architecture, /Réseau Pelote Manager futur/);
  assert.match(architecture, /service séparé du registre commercial/);
  assert.match(architecture, /Tournoi interne/);
  assert.match(architecture, /Tournoi ouvert/);
  assert.match(architecture, /Passeport joueur futur/);
  assert.match(architecture, /sans recréer un compte complet/);
  assert.match(architecture, /consentement du joueur/);
  assert.match(architecture, /ne partagent jamais leurs comptes/);
});
