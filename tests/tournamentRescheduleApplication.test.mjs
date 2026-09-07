import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260907150000_apply_tournament_reschedules_transactionally.sql",
    import.meta.url,
  ),
  "utf8",
);
const adminService = readFileSync(
  new URL(
    "../src/features/admin/tournaments/services/adminTournamentRescheduleService.ts",
    import.meta.url,
  ),
  "utf8",
);
const adminPage = readFileSync(
  new URL(
    "../src/features/admin/tournaments/pages/AdminTournamentReschedulePage.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("un report approuvé est appliqué par une commande admin transactionnelle", () => {
  assert.match(migration, /^begin;/m);
  assert.match(
    migration,
    /create or replace function public\.admin_apply_tournament_reschedule_request/,
  );
  assert.match(migration, /request\.status <> 'approved'/);
  assert.match(migration, /approval\.decision <> 'approved'/);
  assert.match(migration, /for update/);
  assert.match(migration, /update public\.tournament_match_planning/);
  assert.match(migration, /sync_tournament_reschedule_match_event/);
  assert.match(migration, /sync_event_occupations/);
  assert.match(migration, /'reschedule_applied'/);
  assert.match(migration, /application_snapshot/);
  assert.match(migration, /commit;\s*$/);
});

test("un échange modifie les deux matchs ou aucun", () => {
  assert.match(
    migration,
    /delete from public\.tournament_match_planning\s+where match_id in \(request\.match_id, request\.swap_match_id\)/,
  );
  assert.match(
    migration,
    /insert into public\.tournament_match_planning\([\s\S]*target_plan\.match_id[\s\S]*swap_plan\.match_id/,
  );
  assert.match(migration, /calendar_or_planning_conflict/);
  assert.match(migration, /when exclusion_violation or unique_violation/);
});

test("les deux matchs d'un échange sont réservés contre les demandes concurrentes", () => {
  assert.match(
    migration,
    /create table if not exists public\.tournament_reschedule_active_matches/,
  );
  assert.match(migration, /match_id uuid primary key/);
  assert.match(migration, /new\.swap_match_id/);
  assert.match(
    migration,
    /Tournament match is already involved in an active reschedule request/,
  );
});

test("les phases finales gardent leur grille complète synchronisée", () => {
  assert.match(migration, /public\.tournament_final_planning_nodes/);
  assert.match(migration, /final_grid_changed/);
  assert.match(migration, /final_grid_slot_reserved/);
  assert.match(
    migration,
    /update public\.tournament_final_planning_nodes[\s\S]*source = 'manual'/,
  );
});

test("les règles de report sont recontrôlées au moment exact de l'application", () => {
  assert.match(migration, /team_overlap/);
  assert.match(migration, /other_team_daily_load_increased/);
  assert.match(migration, /affected_team_unavailable/);
  assert.match(migration, /calendar_conflict/);
  assert.match(migration, /target_slot_started/);
  assert.doesNotMatch(migration, /minimum_rest_minutes/);
});

test("une équipe sans compte peut répondre hors application sans accord forcé", () => {
  assert.match(
    migration,
    /admin_record_tournament_reschedule_offline_decision/,
  );
  assert.match(
    migration,
    /public\.tournament_team_app_actor_count\(target_team_id\) > 0/,
  );
  assert.match(migration, /decision_source = 'offline_admin'/);
  assert.match(migration, /decision_note = cleaned_note/);
  assert.match(migration, /contact_note/);
  assert.match(adminPage, /Accord recueilli/);
  assert.match(adminPage, /Refus recueilli/);
  assert.doesNotMatch(adminPage, /Forcer l’accord/);
});

test("le back-office déclenche l'application et affiche l'état obsolète", () => {
  assert.match(adminService, /ADMIN_RESCHEDULE_APPLY_LABEL = "Appliquer le report"/);
  assert.match(adminService, /admin_apply_tournament_reschedule_request/);
  assert.match(
    adminService,
    /admin_record_tournament_reschedule_offline_decision/,
  );
  assert.match(adminPage, /ADMIN_RESCHEDULE_APPLY_LABEL/);
  assert.match(adminPage, /staleReasonLabel/);
  assert.match(adminPage, /Planning et calendrier synchronisés/);
});

test("les équipes reliées sont notifiées après application sans bloquer le report", () => {
  assert.match(
    migration,
    /publish_tournament_reschedule_applied_team_notification/,
  );
  assert.match(migration, /'applied'/);
  assert.match(migration, /club_communications/);
  assert.match(migration, /communication_deliveries/);
  assert.match(migration, /exception when others then\s*null;/);
});
