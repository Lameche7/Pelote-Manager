import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260816134500_add_tournament_admin_registration_closed_reminder.sql",
    import.meta.url,
  ),
  "utf8",
);

test("un seul rappel admin est créé au passage à inscriptions closes", () => {
  assert.match(migration, /tournament_admin_reminder_events/);
  assert.match(migration, /primary key \(tournament_id, reminder_kind\)/);
  assert.match(migration, /new\.status = 'registrations_closed'/);
  assert.match(
    migration,
    /publish_tournament_registration_closed_admin_reminder\(new\.id\)/,
  );
});

test("le rappel cible uniquement les profils qui gèrent les tournois", () => {
  assert.match(migration, /club_memberships/);
  assert.match(migration, /club_role_permissions/);
  assert.match(migration, /permission\.permission_key = 'tournaments\.manage'/);
  assert.match(migration, /profile_id_at_publication/);
});

test("le message demande de finaliser le tournoi", () => {
  assert.match(migration, /Inscriptions closes/);
  assert.match(migration, /finaliser les équipes/);
  assert.match(migration, /générer et valider les poules/);
  assert.match(migration, /préparer le planning puis le publier/);
});

test("la clôture automatique est synchronisée toutes les cinq minutes", () => {
  assert.match(migration, /sync_due_tournament_registration_closures/);
  assert.match(
    migration,
    /pelote-manager-tournament-registration-closure-sync/,
  );
  assert.match(migration, /'\*\/5 \* \* \* \*'/);
  assert.match(migration, /sync_tournament_registration_states\(due_club_id\)/);
});

test("une erreur de notification ne bloque jamais la clôture", () => {
  assert.match(
    migration,
    /publish_tournament_registration_closed_admin_reminder\(new\.id\);[\s\S]*exception when others then[\s\S]*null;/,
  );
});

test("le clic ouvre le module admin des tournois", () => {
  assert.match(
    migration,
    /when admin_event\.tournament_id is not null then '\/admin\/tournois'/,
  );
});
