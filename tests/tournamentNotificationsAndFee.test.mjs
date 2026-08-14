import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260814183500_add_tournament_notifications_and_fee.sql";

test("le tarif d'inscription est stocké en centimes et exposé au formulaire admin", async () => {
  const [migration, service, page] = await Promise.all([
    read(migrationPath),
    read("../src/features/admin/tournaments/services/tournamentAdminService.ts"),
    read("../src/features/admin/tournaments/pages/AdminTournamentsPage.tsx"),
  ]);

  assert.match(migration, /registration_fee_cents integer not null default 0/);
  assert.match(migration, /registration_fee_cents', coalesce\(target_fee_cents, 0\)/);
  assert.match(service, /registrationFeeCents: number/);
  assert.match(service, /registration_fee_cents: draft\.registrationFeeCents/);
  assert.match(page, /Tarif d’inscription par équipe \(€\)/);
  assert.match(page, /registrationFeeCents: Math\.round/);
});

test("le tarif est verrouillé après l'ouverture des inscriptions", async () => {
  const migration = await read(migrationPath);

  assert.match(
    migration,
    /previous_status not in \('preparation', 'configuration'\)/,
  );
  assert.match(
    migration,
    /Tournament registration fee is locked after registrations open/,
  );
});

test("les deux notifications de cycle utilisent le moteur central et sont idempotentes", async () => {
  const migration = await read(migrationPath);

  assert.match(migration, /event_kind in \('announced', 'registrations_opened'\)/);
  assert.match(
    migration,
    /new\.status = 'configuration' and old\.status = 'preparation'/,
  );
  assert.match(
    migration,
    /new\.status = 'registrations_open'[\s\S]*old\.status = 'configuration'/,
  );
  assert.match(migration, /insert into public\.club_communications/);
  assert.match(migration, /insert into public\.communication_deliveries/);
  assert.match(migration, /status = 'published'/);
  assert.match(
    migration,
    /primary key \(tournament_id, event_kind\)/,
  );
  assert.match(
    migration,
    /after update of status on public\.tournaments/,
  );
});
