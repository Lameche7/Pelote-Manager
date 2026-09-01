import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseErrebotAvailabilityWorkbook } from "../.test-dist/src/features/admin/tournaments/domain/errebotAvailabilityImport.js";

const foundationMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260901194500_admin_import_errebot_availability.sql",
    import.meta.url,
  ),
  "utf8",
);
const phaseMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260901200000_errebot_xlsx_phase_availability.sql",
    import.meta.url,
  ),
  "utf8",
);
const service = readFileSync(
  new URL(
    "../src/features/admin/tournaments/services/adminErrebotAvailabilityImportService.ts",
    import.meta.url,
  ),
  "utf8",
);
const workbookService = readFileSync(
  new URL(
    "../src/features/admin/tournaments/services/errebotAvailabilityWorkbookService.ts",
    import.meta.url,
  ),
  "utf8",
);
const component = readFileSync(
  new URL(
    "../src/features/admin/tournaments/components/AdminErrebotAvailabilityImport.tsx",
    import.meta.url,
  ),
  "utf8",
);
const teamsPage = readFileSync(
  new URL(
    "../src/features/admin/tournaments/pages/AdminTournamentTeamsPage.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("le classeur Errebot lit directement les onglets poules et phases finales", () => {
  const parsed = parseErrebotAvailabilityWorkbook(
    [
      {
        sheet: "Poules",
        data: [
          [
            "Série",
            "ID équipe",
            "Joueur1",
            "Joueur2",
            "21/09/2026 17h30   (27367)",
            "21/09/2026 18h30   (27368)",
          ],
          ["1re", 100, "Alice", "Bob", "X", ""],
          ["1re", 101, "Chloé", "David", 0, true],
        ],
      },
      {
        sheet: "Phases finales",
        data: [
          [
            "Série",
            "ID équipe",
            "Joueur1",
            "Joueur2",
            "05/10/2026 19h30 (27409)",
          ],
          ["1re", 100, "Alice", "Bob", "oui"],
          ["1re", 101, "Chloé", "David", ""],
        ],
      },
    ],
    60,
    true,
  );

  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.sourceSlots, [
    {
      phase: "pools",
      playDate: "2026-09-21",
      startsAt: "17:30",
      endsAt: "18:30",
      sourceSlotId: "27367",
    },
    {
      phase: "pools",
      playDate: "2026-09-21",
      startsAt: "18:30",
      endsAt: "19:30",
      sourceSlotId: "27368",
    },
    {
      phase: "finals",
      playDate: "2026-10-05",
      startsAt: "19:30",
      endsAt: "20:30",
      sourceSlotId: "27409",
    },
  ]);
  assert.deepEqual(parsed.declarations, [
    { externalTeamId: "100", phase: "pools", slotCount: 1 },
    { externalTeamId: "101", phase: "pools", slotCount: 1 },
    { externalTeamId: "100", phase: "finals", slotCount: 1 },
    { externalTeamId: "101", phase: "finals", slotCount: 0 },
  ]);
  assert.deepEqual(parsed.rows, [
    {
      externalTeamId: "100",
      phase: "pools",
      playDate: "2026-09-21",
      startsAt: "17:30",
      endsAt: "18:30",
    },
    {
      externalTeamId: "101",
      phase: "pools",
      playDate: "2026-09-21",
      startsAt: "18:30",
      endsAt: "19:30",
    },
    {
      externalTeamId: "100",
      phase: "finals",
      playDate: "2026-10-05",
      startsAt: "19:30",
      endsAt: "20:30",
    },
  ]);
  assert.equal(parsed.sheets[0].teamCount, 2);
  assert.equal(parsed.sheets[1].teamCount, 2);
});

test("une équipe sans créneau coché reste une disponibilité connue à zéro", () => {
  const parsed = parseErrebotAvailabilityWorkbook(
    [
      {
        sheet: "Poules - disponibilités",
        data: [
          ["ID équipe", "21/09/2026 17h30 (27367)"],
          [100, ""],
        ],
      },
    ],
    60,
    false,
  );

  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.rows, []);
  assert.equal(parsed.sourceSlots.length, 1);
  assert.deepEqual(parsed.declarations, [
    { externalTeamId: "100", phase: "pools", slotCount: 0 },
  ]);
});

test("le parseur exige les deux onglets lorsque les finales sont configurées", () => {
  const parsed = parseErrebotAvailabilityWorkbook(
    [
      {
        sheet: "Poules",
        data: [
          ["ID équipe", "21/09/2026 17h30 (27367)"],
          [100, "X"],
        ],
      },
    ],
    60,
    true,
  );

  assert.match(parsed.issues[0].message, /phases finales/i);
});

test("la grille exacte Errebot remplace la génération native phase par phase", () => {
  assert.match(
    phaseMigration,
    /create table if not exists public\.tournament_import_availability_slots/,
  );
  assert.match(phaseMigration, /source_slot_id text/);
  assert.match(
    phaseMigration,
    /create or replace function public\.tournament_generated_slots/,
  );
  assert.match(phaseMigration, /source_phases as/);
  assert.match(
    phaseMigration,
    /where not exists \([\s\S]*imported_phase\.phase = native\.phase/,
  );
  assert.doesNotMatch(phaseMigration, /finals_not_configured/);
  assert.match(phaseMigration, /normalized_source_slots/);
});

test("l'import différé reste administratif et ne modifie jamais le planning", () => {
  assert.match(
    foundationMigration,
    /create table if not exists public\.tournament_import_team_availability_state/,
  );
  assert.match(
    phaseMigration,
    /create or replace function public\.admin_preview_errebot_availability_import/,
  );
  assert.match(
    phaseMigration,
    /create or replace function public\.admin_import_errebot_availability/,
  );
  assert.match(phaseMigration, /public\.tournament_import_team_refs/);
  assert.match(phaseMigration, /public\.tournament_generated_slots/);
  assert.match(phaseMigration, /public\.tournament_team_availability_slots/);
  assert.match(phaseMigration, /has_club_permission[\s\S]*tournaments\.manage/);
  assert.match(phaseMigration, /errebot_availability_imported/);
  assert.doesNotMatch(
    phaseMigration,
    /insert into public\.tournament_match_planning/,
  );
  assert.doesNotMatch(
    phaseMigration,
    /update public\.tournament_match_planning/,
  );
  assert.doesNotMatch(
    phaseMigration,
    /delete from public\.tournament_match_planning/,
  );
});

test("la couverture Errebot est séparée entre poules et phases finales", () => {
  assert.match(phaseMigration, /pools_known boolean not null default false/);
  assert.match(phaseMigration, /finals_known boolean not null default false/);
  assert.match(phaseMigration, /generated\.phase = target_phase/);
  assert.match(
    phaseMigration,
    /when target_phase = 'finals' then state\.finals_known/,
  );
  assert.match(
    phaseMigration,
    /restrict_swaps := is_errebot_import and not coverage_complete/,
  );
  assert.match(phaseMigration, /'partial_from_errebot'/);
  assert.match(phaseMigration, /'errebot_imported'/);
  assert.match(
    phaseMigration,
    /jsonb_set\(result, '\{swaps\}', '\[\]'::jsonb, true\)/,
  );
});

test("le back-office accepte directement le xlsx Errebot sans transmettre les joueurs", () => {
  assert.match(workbookService, /read-excel-file\/browser/);
  assert.match(service, /external_team_id: item\.externalTeamId/);
  assert.match(service, /source_slots: sourceSlots\.map/);
  assert.match(service, /source_slot_id: item\.sourceSlotId/);
  assert.doesNotMatch(service, /Joueur1|Joueur2|player1|player2/);
  assert.match(component, /Classeur Excel Errebot \(\.xlsx\)/);
  assert.match(component, /Joueur1\/Joueur2 sont ignorées/);
  assert.match(component, /grille exacte Errebot/);
  assert.match(component, /Poules après import/);
  assert.match(component, /Phases finales/);
  assert.match(teamsPage, /AdminErrebotAvailabilityImport/);
  assert.match(teamsPage, /onImported=\{reloadSelected\}/);
});
