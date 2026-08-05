import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "supabase/migrations/20260805040000_harden_admin_access.sql",
  "utf8",
);
const layout = readFileSync("src/app/layouts/MainLayout.tsx", "utf8");
const provider = readFileSync(
  "src/features/admin/access/AdminAccessProvider.tsx",
  "utf8",
);
const shell = readFileSync(
  "src/features/admin/components/AdminShell.tsx",
  "utf8",
);
const usersPage = readFileSync(
  "src/features/admin/pages/AdminUsersPage.tsx",
  "utf8",
);

function extractFunction(name) {
  const pattern = new RegExp(
    `create or replace function public\\.${name}\\([\\s\\S]*?\\n\\$\\$;`,
    "i",
  );
  const match = migration.match(pattern);
  assert.ok(match, `La fonction ${name} doit être redéfinie.`);
  return match[0];
}

test("reprend les anciens profils administrateurs dans le club unique", () => {
  assert.match(migration, /Admin access hardening requires exactly one club per instance/);
  assert.match(migration, /from public\.profiles as profiles/);
  assert.match(migration, /profiles\.role = 'admin'::public\.user_role/);
  assert.match(migration, /insert into public\.club_memberships/);
  assert.match(migration, /on conflict \(club_id, profile_id\)/);
  assert.match(migration, /do update set role_id = excluded\.role_id/);
});

test("l'habilitation de club remplace profiles.role comme source de vérité", () => {
  const isAdminFunction = extractFunction("is_profile_admin");
  assert.match(isAdminFunction, /public\.club_memberships/);
  assert.match(isAdminFunction, /public\.club_role_permissions/);
  assert.match(isAdminFunction, /grants\.permission_key = 'settings\.manage'/);
  assert.doesNotMatch(isAdminFunction, /public\.profiles/);
});

test("la gestion des utilisateurs synchronise le rôle et l'habilitation", () => {
  const setRoleFunction = extractFunction("set_profile_role");
  assert.match(setRoleFunction, /public\.admin_current_club_id\(\)/);
  assert.match(setRoleFunction, /public\.has_club_permission\(actor_club_id, 'settings\.manage'\)/);
  assert.match(setRoleFunction, /if new_role = 'admin'::public\.user_role/);
  assert.match(setRoleFunction, /insert into public\.club_memberships/);
  assert.match(setRoleFunction, /delete from public\.club_memberships/);
  assert.match(setRoleFunction, /roles\.key = 'administrator'::public\.club_role_key/);
});

test("le lien et la route Administration exigent une permission réelle", () => {
  assert.match(layout, /adminAccessService/);
  assert.match(layout, /getOptionalAccess\(\)/);
  assert.match(layout, /canAccessAdminDashboard\(adminAccess\)/);
  assert.match(provider, /getOptionalAccess\(\)/);
  assert.match(shell, /if \(!access\) return <Navigate to=\{ROUTES\.forbidden\} replace \/>/);
});

test("l'écran utilisateurs annonce la synchronisation automatique", () => {
  assert.match(usersPage, /Attribuer le rôle Administrateur/);
  assert.match(usersPage, /sans intervention dans Supabase/);
  assert.match(usersPage, /rôle et les habilitations/);
});
