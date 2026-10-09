import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync("supabase/migrations/20261008211000_scope_admin_profiles_to_club.sql", "utf8");
const page = readFileSync("src/features/admin/pages/AdminUsersPage.tsx", "utf8");
test("annuaire admin borné au club, pas à la plateforme", () => {
  assert.match(migration, /admin_current_club_id\(\)/);
  assert.match(migration, /has_club_permission\(actor_club_id, 'settings.manage'\)/);
  assert.match(migration, /m.club_id=actor_club_id/);
  assert.match(migration, /cm.club_id=actor_club_id/);
});
test("aucune modification du rôle global", () => {
  assert.doesNotMatch(migration, /update public\.profiles/i);
  assert.match(migration, /new_role not in/);
  assert.match(migration, /target_profile_id=auth.uid\(\)/);
  assert.match(migration, /insert into public\.club_memberships/);
  assert.match(migration, /delete from public\.club_memberships/);
});
test("licence distincte de l'administration", () => {
  assert.match(migration, /is_active_licensee_for_club/);
  assert.match(page, /Nommer administrateur/);
  assert.match(page, /Retirer l’administration/);
});

test("un administrateur de club ne peut pas être nommé administrateur d'un second club", () => {
  assert.match(migration, /other_membership.club_id<>actor_club_id/);
  assert.match(migration, /other_role.key='administrator'/);
  assert.match(migration, /already administers another club/);
});

test("la limite d'un administrateur par club est aussi appliquée aux écritures directes", () => {
  assert.match(migration, /create trigger enforce_single_club_administrator/);
  assert.match(migration, /before insert or update of club_id, profile_id, role_id/);
  assert.match(migration, /where p.id = new.profile_id for update/);
  assert.match(migration, /cm.club_id <> new.club_id/);
});

test("les trois fonctions PL/pgSQL se terminent avec END point-virgule", () => {
  const bodies = migration.match(/end;\s*\$function\$;/gi) ?? [];
  assert.equal(bodies.length, 3);
  assert.doesNotMatch(migration, /end\s*\n\$function\$;/i);
});
