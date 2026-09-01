import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { parseErrebotAvailabilityImport } from "../.test-dist/src/features/admin/tournaments/domain/errebotAvailabilityImport.js";

const migration = readFileSync(
  new URL(
    "../supabase/migrations/20260901194500_admin_import_errebot_availability.sql",
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

test("le fichier de disponibilités Errebot accepte CSV ou TSV et calcule la fin", () => {
  const parsed = parseErrebotAvailabilityImport(
    [
      "N° équipe;Date;Heure",
      "100;24/08/2026;18:30",
      "101;2026-08-25;19h30",
    ].join("\n"),
    60,
  );

  assert.deepEqual(parsed.issues, []);
  assert.deepEqual(parsed.rows, [
    {
      externalTeamId: "100",
      playDate: "2026-08-24",
      startsAt: "18:30",
      endsAt: "19:30",
    },
    {
      externalTeamId: "101",
      playDate: "2026-08-25",
      startsAt: "19:30",
      endsAt: "20:30",
    },
  ]);
});

test("le parseur refuse les en-têtes incomplets et les doublons", () => {
  const missing = parseErrebotAvailabilityImport(
    "Equipe;Date\n100;24/08/2026",
    60,
  );
  assert.equal(missing.rows.length, 0);
  assert.equal(missing.issues.length, 1);

  const duplicate = parseErrebotAvailabilityImport(
    [
      "Equipe\tDate\tHeure\tFin",
      "100\t24/08/2026\t18:30\t19:30",
      "100\t24/08/2026\t18:30\t19:30",
    ].join("\n"),
    60,
  );
  assert.equal(duplicate.rows.length, 1);
  assert.match(duplicate.issues[0].message, /doublon/i);
});

test("l'import différé reste administratif, validé et sans mutation du planning", () => {
  assert.match(
    migration,
    /create table if not exists public\.tournament_import_team_availability_state/,
  );
  assert.match(
    migration,
    /create or replace function public\.admin_preview_errebot_availability_import/,
  );
  assert.match(
    migration,
    /create or replace function public\.admin_import_errebot_availability/,
  );
  assert.match(migration, /public\.tournament_import_team_refs/);
  assert.match(migration, /public\.tournament_generated_slots/);
  assert.match(migration, /public\.tournament_team_availability_slots/);
  assert.match(migration, /has_club_permission[\s\S]*tournaments\.manage/);
  assert.match(migration, /errebot_availability_imported/);
  assert.doesNotMatch(
    migration,
    /insert into public\.tournament_match_planning/,
  );
  assert.doesNotMatch(migration, /update public\.tournament_match_planning/);
  assert.doesNotMatch(
    migration,
    /delete from public\.tournament_match_planning/,
  );
});

test("les échanges Errebot restent bloqués jusqu'à la couverture complète", () => {
  assert.match(
    migration,
    /coverage_complete := accepted_team_count > 0 and known_team_count = accepted_team_count/,
  );
  assert.match(
    migration,
    /restrict_swaps := is_errebot_import and not coverage_complete/,
  );
  assert.match(migration, /'partial_from_errebot'/);
  assert.match(migration, /'errebot_imported'/);
  assert.match(
    migration,
    /jsonb_set\(result, '\{swaps\}', '\[\]'::jsonb, true\)/,
  );
});

test("le back-office expose prévisualisation puis import dans Équipes & inscriptions", () => {
  assert.match(service, /admin_get_errebot_availability_import_context/);
  assert.match(service, /admin_preview_errebot_availability_import/);
  assert.match(service, /admin_import_errebot_availability/);
  assert.match(component, /Disponibilités des équipes/);
  assert.match(
    component,
    /Cette opération ne modifie ni les matchs ni le planning publié/,
  );
  assert.match(component, /Prévisualisation/);
  assert.match(component, /Importer \$\{preview\.rowCount\} créneaux/);
  assert.match(teamsPage, /AdminErrebotAvailabilityImport/);
  assert.match(teamsPage, /onImported=\{reloadSelected\}/);
});
