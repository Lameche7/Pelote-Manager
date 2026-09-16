import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260916134500_add_championship_archive_action.sql",
    import.meta.url,
  ),
  "utf8",
);
const component = await readFile(
  new URL(
    "../src/features/admin/championships/components/ChampionshipResultSettingsCard.tsx",
    import.meta.url,
  ),
  "utf8",
);
const service = await readFile(
  new URL(
    "../src/features/admin/championships/services/championshipLifecycleService.ts",
    import.meta.url,
  ),
  "utf8",
);

test("l’archivage championnat est protégé et audité côté base", () => {
  assert.match(migration, /admin_archive_championship/);
  assert.match(
    migration,
    /championship_club_can_manage\(target_id, target_club_id\)/,
  );
  assert.match(migration, /status = 'archived'::public\.championship_status/);
  assert.match(migration, /'championship_archived'/);
  assert.match(
    migration,
    /revoke all on function public\.admin_archive_championship\(uuid\)/,
  );
  assert.match(
    migration,
    /grant execute on function public\.admin_archive_championship\(uuid\)\s+to authenticated/,
  );
});

test("le service admin appelle uniquement le RPC d’archivage", () => {
  assert.match(service, /rpc\("admin_archive_championship"/);
  assert.match(service, /target_id: championshipId/);
});

test("l’interface demande confirmation et explique l’effet sur les réservations", () => {
  assert.match(component, /Archiver le championnat/);
  assert.match(component, /window\.confirm/);
  assert.match(component, /droits de réservation/);
  assert.match(component, /championshipStatus !== "archived"/);
});
