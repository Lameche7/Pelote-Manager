import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const read = (path) =>
  readFile(new URL(`../${path}`, import.meta.url), "utf8");

test("l'admin peut créer une demande de report sans compte joueur", async () => {
  const [migration, service, form, page] = await Promise.all([
    read(
      "supabase/migrations/20260916190000_add_admin_manual_tournament_reschedules.sql",
    ),
    read(
      "src/features/admin/tournaments/services/adminTournamentManualRescheduleService.ts",
    ),
    read(
      "src/features/admin/tournaments/components/AdminTournamentManualRescheduleForm.tsx",
    ),
    read(
      "src/features/admin/tournaments/pages/AdminTournamentReschedulePage.tsx",
    ),
  ]);

  assert.match(migration, /admin_get_tournament_manual_reschedule_context/);
  assert.match(migration, /admin_get_tournament_manual_reschedule_slots/);
  assert.match(migration, /admin_create_tournament_manual_reschedule_request/);
  assert.match(migration, /has_club_permission\(target_club_id, 'tournaments\.manage'\)/);
  assert.match(migration, /'offline_admin'/);
  assert.match(migration, /'admin_manual'/);
  assert.match(migration, /tournament_reschedule_approvals/);
  assert.match(migration, /'pending'/);
  assert.match(service, /admin_create_tournament_manual_reschedule_request/);
  assert.match(form, /Créer un report de A à Z/);
  assert.match(form, /Équipe à l’origine de la demande/);
  assert.match(form, /Nouveau créneau/);
  assert.match(page, /AdminTournamentManualRescheduleForm/);
});

test("un compte relié après la création retrouve une demande déjà existante", async () => {
  const requestMigration = await read(
    "supabase/migrations/20260901213000_tournament_reschedule_requests.sql",
  );

  assert.match(
    requestMigration,
    /public\.tournament_profile_can_act_for_team\(approval\.team_id, auth\.uid\(\)\)/,
  );
  assert.match(
    requestMigration,
    /where approval\.request_id = request\.id[\s\S]*public\.tournament_profile_can_act_for_team/,
  );
  assert.match(
    requestMigration,
    /'can_act', approval\.decision = 'pending'[\s\S]*public\.tournament_profile_can_act_for_team/,
  );
});
