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
const poolMigration = readFileSync(
  new URL(
    "../supabase/migrations/20260901201500_errebot_pool_availability_only.sql",
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

test("le classeur Errebot importe uniquement l onglet de poules", () => {
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
        ],
      },
    ],
    60,
  );

  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.sourceSlots, [
    {
      playDate: "2026-09-21",
      startsAt: "17:30",
      endsAt: "18:30",
      sourceSlotId: "27367",
    },
    {
      playDate: "2026-09-21",
      startsAt: "18:30",
      endsAt: "19:30",
      sourceSlotId: "27368",
    },
  ]);
  assert.deepEqual(parsed.declarations, [
    { externalTeamId: "100", slotCount: 1 },
    { externalTeamId: "101", slotCount: 1 },
  ]);
  assert.deepEqual(parsed.rows, [
    {
      externalTeamId: "100",
      playDate: "2026-09-21",
      startsAt: "17:30",
      endsAt: "18:30",
    },
    {
      externalTeamId: "101",
      playDate: "2026-09-21",
      startsAt: "18:30",
      endsAt: "19:30",
    },
  ]);
  assert.equal(parsed.sheets.length, 1);
  assert.equal(parsed.sheets[0].sheet, "Poules");
  assert.equal(parsed.sheets[0].teamCount, 2);
  assert.equal(parsed.sheets[0].sourceSlotCount, 2);
});

test("une équipe de poule sans créneau coché reste connue à zéro", () => {
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
  );

  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.rows, []);
  assert.equal(parsed.sourceSlots.length, 1);
  assert.deepEqual(parsed.declarations, [
    { externalTeamId: "100", slotCount: 0 },
  ]);
});

test("le parseur exige seulement un onglet de poules", () => {
  const missingPools = parseErrebotAvailabilityWorkbook(
    [
      {
        sheet: "Phases finales",
        data: [
          ["ID équipe", "05/10/2026 19h30 (27409)"],
          [100, "X"],
        ],
      },
    ],
    60,
  );

  assert.match(missingPools.issues[0].message, /poules/i);
});

test("la grille exacte Errebot remplace seulement la génération native des poules", () => {
  assert.match(
    poolMigration,
    /create table if not exists public\.tournament_import_availability_slots/,
  );
  assert.match(poolMigration, /source_slot_id text/);
  assert.match(
    poolMigration,
    /create or replace function public\.tournament_generated_slots/,
  );
  assert.match(poolMigration, /source_pool_slots as/);
  assert.match(poolMigration, /native_phases as/);
  assert.match(poolMigration, /'finals'::text/);
  assert.match(poolMigration, /planned_pool_slots as/);
  assert.match(poolMigration, /normalized_source_slots/);
});

test("une ancienne tentative d import de finales Errebot est neutralisée", () => {
  assert.match(
    poolMigration,
    /delete from public\.tournament_team_availability_slots as availability[\s\S]*source\.phase = 'finals'/,
  );
  assert.match(
    poolMigration,
    /delete from public\.tournament_import_availability_slots[\s\S]*where phase = 'finals'/,
  );
  assert.match(poolMigration, /'finals_imported', false/);
});

test("l import différé reste administratif et ne modifie jamais le planning", () => {
  assert.match(
    foundationMigration,
    /create table if not exists public\.tournament_import_team_availability_state/,
  );
  assert.match(
    poolMigration,
    /create or replace function public\.admin_preview_errebot_availability_import/,
  );
  assert.match(
    poolMigration,
    /create or replace function public\.admin_import_errebot_availability/,
  );
  assert.match(poolMigration, /public\.tournament_import_team_refs/);
  assert.match(poolMigration, /public\.tournament_team_availability_slots/);
  assert.match(poolMigration, /has_club_permission[\s\S]*tournaments\.manage/);
  assert.match(poolMigration, /errebot_pool_availability_imported/);
  assert.doesNotMatch(
    poolMigration,
    /insert into public\.tournament_match_planning/,
  );
  assert.doesNotMatch(poolMigration, /update public\.tournament_match_planning/);
  assert.doesNotMatch(
    poolMigration,
    /delete from public\.tournament_match_planning/,
  );
});

test("les échanges Errebot sont débloqués uniquement par la couverture des poules", () => {
  assert.match(poolMigration, /target_phase = 'pools'/);
  assert.match(
    poolMigration,
    /coverage_complete := accepted_team_count > 0[\s\S]*known_team_count = accepted_team_count/,
  );
  assert.match(poolMigration, /restrict_swaps := not coverage_complete/);
  assert.match(poolMigration, /'partial_from_errebot'/);
  assert.match(poolMigration, /'errebot_imported'/);
  assert.match(
    poolMigration,
    /jsonb_set\(result, '\{swaps\}', '\[\]'::jsonb, true\)/,
  );
});

test("le back-office lit le xlsx Errebot sans importer les phases finales ni les joueurs", () => {
  assert.match(workbookService, /read-excel-file\/browser/);
  assert.doesNotMatch(workbookService, /finalsRequired/);
  assert.match(service, /external_team_id: item\.externalTeamId/);
  assert.match(service, /source_slots: sourceSlots\.map/);
  assert.match(service, /source_slot_id: item\.sourceSlotId/);
  assert.doesNotMatch(service, /finalsKnown|finalsCoverage|Joueur1|Joueur2/);
  assert.match(component, /Disponibilités des équipes — poules/);
  assert.match(component, /uniquement l’onglet des poules/);
  assert.match(component, /L’onglet des phases finales est[\s\S]*ignoré/);
  assert.match(component, /Joueur1\/Joueur2 sont ignorées/);
  assert.match(teamsPage, /AdminErrebotAvailabilityImport/);
  assert.match(teamsPage, /onImported=\{reloadSelected\}/);
});
