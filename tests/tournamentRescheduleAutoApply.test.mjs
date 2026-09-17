import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260917145000_auto_apply_tournament_reschedules.sql",
    import.meta.url,
  ),
  "utf8",
);
const playerService = readFileSync(
  new URL(
    "../src/features/user-space/tournaments/services/tournamentRescheduleService.ts",
    import.meta.url,
  ),
  "utf8",
);

test("le dernier accord joueur applique automatiquement le report", () => {
  assert.match(
    migration,
    /decide_my_tournament_reschedule_request\(uuid,uuid,text\)/,
  );
  assert.match(migration, /if next_status = ''approved'' then/);
  assert.match(
    migration,
    /admin_apply_tournament_reschedule_request\(request\.id\)/,
  );
  assert.match(
    migration,
    /return coalesce\(application_result->>''status'', next_status\)/,
  );
});

test("un participant ne peut appliquer que le report d'une équipe qu'il représente", () => {
  assert.match(migration, /caller_can_apply/);
  assert.match(migration, /has_club_permission/);
  assert.match(
    migration,
    /tournament_profile_can_act_for_team\(approval\.team_id, auth\.uid\(\)\)/,
  );
  assert.match(migration, /if not caller_can_apply then/);
});

test("le dernier accord hors application bénéficie du même automatisme", () => {
  assert.match(
    migration,
    /admin_record_tournament_reschedule_offline_decision\(uuid,uuid,text,text\)/,
  );
  assert.match(
    migration,
    /admin_apply_tournament_reschedule_request\(target_request\.id\)/,
  );
});

test("le client joueur sait déjà recevoir applied ou stale", () => {
  assert.match(
    playerService,
    /"pending" \| "approved" \| "rejected" \| "cancelled" \| "stale" \| "applied"/,
  );
  assert.match(playerService, /return requestStatus\(data\)/);
});

test("la migration échoue explicitement si le moteur attendu a dérivé", () => {
  assert.match(migration, /could not patch application declaration/);
  assert.match(migration, /could not replace admin-only application guard/);
  assert.match(migration, /could not patch player automatic application/);
  assert.match(migration, /^begin;/m);
  assert.match(migration, /commit;\s*$/);
});
