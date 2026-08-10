import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260810134500_auto_accept_tournament_registrations.sql";
const registrationFormPath =
  "../src/features/tournaments/components/TournamentRegistrationForm.tsx";

test("les inscriptions en ligne sont acceptées automatiquement", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /new\.submitted_by is not null and new\.status = 'pending'/,
  );
  assert.match(migration, /new\.status := 'accepted'/);
  assert.match(
    migration,
    /where submitted_by is not null[\s\S]*and status = 'pending'/,
  );
});

test("le formulaire n'annonce plus de validation manuelle", async () => {
  const form = await read(registrationFormPath);

  assert.match(form, /Votre équipe est inscrite au tournoi/);
  assert.match(form, /Votre inscription a été mise à jour/);
  assert.doesNotMatch(form, /attend la validation du club/);
  assert.doesNotMatch(form, /repasse en validation/);
});

test("le partenaire d'un autre club peut être saisi manuellement", async () => {
  const form = await read(registrationFormPath);

  assert.match(form, /partenaire d’un autre club/);
  assert.match(form, /renseignez[\s\S]*ses coordonnées ci-dessous/);
  assert.match(form, /partnerMemberId: null/);
});
