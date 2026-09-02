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
const finalAvailabilityMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260901203000_errebot_final_availability_for_native_finals.sql",
    import.meta.url,
  ),
  "utf8",
);
const nativeFinalPlanningMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260827200000_full_final_stage_planning.sql",
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

test("le classeur Errebot lit les disponibilités de poules et de futures finales", () => {
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
  assert.equal(parsed.rows.length, 3);
  assert.equal(parsed.sheets.length, 2);
});

test("une équipe sans créneau final coché reste une disponibilité finale connue à zéro", () => {
  const parsed = parseErrebotAvailabilityWorkbook(
    [
      {
        sheet: "Poules",
        data: [
          ["ID équipe", "21/09/2026 17h30 (27367)"],
          [100, "X"],
        ],
      },
      {
        sheet: "Phases finales",
        data: [
          ["ID équipe", "05/10/2026 19h30 (27409)"],
          [100, ""],
        ],
      },
    ],
    60,
    true,
  );

  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.declarations[1], {
    externalTeamId: "100",
    phase: "finals",
    slotCount: 0,
  });
});

test("le parseur exige la matrice finale car elle sert au futur planning natif", () => {
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

test("les disponibilités finales Errebot n importent aucune structure finale", () => {
  assert.match(
    foundationMigration,
    /create table if not exists public\.tournament_import_team_availability_state/,
  );
  assert.match(finalAvailabilityMigration, /finals_known boolean/);
  assert.match(finalAvailabilityMigration, /finals_slot_count integer/);
  assert.match(finalAvailabilityMigration, /source\.phase/);
  assert.match(
    finalAvailabilityMigration,
    /'finals_structure_imported', false/,
  );
  assert.doesNotMatch(
    finalAvailabilityMigration,
    /insert into public\.tournament_final_seeds/,
  );
  assert.doesNotMatch(
    finalAvailabilityMigration,
    /insert into public\.tournament_final_planning_nodes/,
  );
  assert.doesNotMatch(
    finalAvailabilityMigration,
    /insert into public\.tournament_matches/,
  );
});

test("la grille finale Errebot nourrit le moteur final natif", () => {
  assert.match(
    finalAvailabilityMigration,
    /create or replace function public\.tournament_generated_slots/,
  );
  assert.match(finalAvailabilityMigration, /source_phases as/);
  assert.match(finalAvailabilityMigration, /phase = 'finals'/);
  assert.match(finalAvailabilityMigration, /finals_starts_on = finals_start/);
  assert.match(finalAvailabilityMigration, /finals_ends_on = finals_end/);
  assert.match(nativeFinalPlanningMigration, /generated\.phase = 'finals'/);
  assert.match(
    nativeFinalPlanningMigration,
    /public\.tournament_team_availability_slots/,
  );
});

test("l import des disponibilités ne déplace jamais le planning existant", () => {
  assert.match(
    finalAvailabilityMigration,
    /create or replace function public\.admin_import_errebot_availability/,
  );
  assert.match(
    finalAvailabilityMigration,
    /has_club_permission[\s\S]*tournaments\.manage/,
  );
  assert.doesNotMatch(
    finalAvailabilityMigration,
    /insert into public\.tournament_match_planning/,
  );
  assert.doesNotMatch(
    finalAvailabilityMigration,
    /update public\.tournament_match_planning/,
  );
  assert.doesNotMatch(
    finalAvailabilityMigration,
    /delete from public\.tournament_match_planning/,
  );
});

test("les reports Errebot utilisent la couverture de la phase concernée", () => {
  assert.match(
    finalAvailabilityMigration,
    /target_phase in \('pools', 'finals'\)/,
  );
  assert.match(
    finalAvailabilityMigration,
    /when target_phase = 'finals' then state\.finals_known/,
  );
  assert.match(finalAvailabilityMigration, /else state\.pools_known/);
  assert.match(
    finalAvailabilityMigration,
    /restrict_swaps := not coverage_complete/,
  );
});

test("le back-office explique que l onglet final apporte seulement des disponibilités", () => {
  assert.match(workbookService, /read-excel-file\/browser/);
  assert.match(workbookService, /finalsRequired/);
  assert.match(service, /phase: item\.phase/);
  assert.match(service, /finalsKnownTeamCount/);
  assert.doesNotMatch(service, /Joueur1|Joueur2|player1|player2/);
  assert.match(
    component,
    /Le tournoi Errebot importé reste un tournoi de poules/,
  );
  assert.match(component, /Aucun match final Errebot n’a été importé/);
  assert.match(component, /moteur natif de génération et de planification/);
  assert.match(teamsPage, /AdminErrebotAvailabilityImport/);
  assert.match(teamsPage, /onImported=\{reloadSelected\}/);
});
