import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildChampionshipTransactionalImportPayload,
  extractChampionshipSourceExternalId,
  inferChampionshipSeasonLabel,
} from "../.test-dist/src/features/admin/championships/domain/championshipTransactionalImport.js";

test("identifie une compétition avec le domaine fédéral et son identifiant", () => {
  assert.equal(
    extractChampionshipSourceExternalId(
      "lbpb.competition.ffpb.net?id_competition=7",
    ),
    "lbpb.competition.ffpb.net:competition:7",
  );
  assert.equal(
    extractChampionshipSourceExternalId(
      "https://lbpb.competition.ffpb.net/FFPB_COMPETITION/PAGE_COMPETITION_INVITE/wAYAANYO2gIDAA?M31",
    ),
    "lbpb.competition.ffpb.net:FFPB_COMPETITION/PAGE_COMPETITION_INVITE/wAYAANYO2gIDAA?M31",
  );
});

test("déduit la saison lorsqu’elle figure dans le libellé officiel", () => {
  assert.equal(inferChampionshipSeasonLabel("CHAMPIONNAT HIVER 2026"), "2026");
  assert.equal(
    inferChampionshipSeasonLabel("CHAMPIONNAT 2026-2027"),
    "2026-2027",
  );
});

test("prépare les équipes d’une partie sans perdre le club ni le numéro", () => {
  const preview = {
    valid: true,
    competition: "CHAMPIONNAT HIVER 2026",
    specialty: "Paleta gomme pleine masculin",
    federationClubs: ["CLUB ALPHA", "CLUB BETA"],
    divisions: [],
    issues: [],
    teamCount: 2,
    playerCount: 4,
    matchCount: 1,
    poolCount: 1,
    uniquePlayers: [],
    engagements: [
      {
        row: 2,
        competition: "CHAMPIONNAT HIVER 2026",
        specialty: "Paleta gomme pleine masculin",
        category: "Senior 1ère Série",
        poolCode: "1",
        sourceRank: null,
        teamLabel: "CLUB ALPHA 01",
        clubName: "CLUB ALPHA",
        teamNumber: "01",
        players: [],
      },
    ],
    matches: [
      {
        row: 2,
        competition: "CHAMPIONNAT HIVER 2026",
        specialty: "Paleta gomme pleine masculin",
        category: "Senior 1ère Série",
        phase: "Poules",
        team1Label: "CLUB ALPHA 01",
        team2Label: "CLUB BETA 02",
        scheduledOn: "2026-10-12",
        scheduledTime: "17:30",
        reportOn: null,
        reportTime: null,
        venue: "Trinquet",
        agreementOn: null,
        agreementTime: null,
        agreementVenue: null,
        status: "scheduled",
        scoreRaw: null,
        scoreTeam1: null,
        scoreTeam2: null,
        resultComment: null,
        sourceKey: "match-1",
        sourceMetadata: {},
      },
    ],
  };

  const payload = buildChampionshipTransactionalImportPayload(preview, {
    sourceUrl: "lbpb.competition.ffpb.net?id_competition=7",
    localFederationClubName: "CLUB ALPHA",
    files: [
      {
        kind: "matches",
        fileName: "parties.xlsx",
        checksum: "matches",
        rowCount: 1,
      },
      {
        kind: "engagements",
        fileName: "engagements.csv",
        checksum: "engagements",
        rowCount: 2,
      },
    ],
  });

  assert.deepEqual(payload.matches[0].team1, {
    clubName: "CLUB ALPHA",
    teamNumber: "01",
  });
  assert.deepEqual(payload.matches[0].team2, {
    clubName: "CLUB BETA",
    teamNumber: "02",
  });
  assert.equal(
    payload.championship.sourceExternalId,
    "lbpb.competition.ffpb.net:competition:7",
  );
});

test("la migration conserve l’import en une transaction et ne crée pas de licencié adverse", async () => {
  const sql = await readFile(
    new URL(
      "../supabase/migrations/20260906153500_add_championship_source_import.sql",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(
    sql,
    /create or replace function public\.admin_import_championship_sources\(payload jsonb\)/,
  );
  assert.match(
    sql,
    /public\.has_club_permission\(v_target_club_id, 'championships\.manage'\)/,
  );
  assert.match(sql, /insert into public\.championship_import_batches/);
  assert.match(sql, /insert into public\.championship_players/);
  assert.doesNotMatch(sql, /insert into public\.club_members/);
  assert.match(sql, /profile\.member_id = member\.id/);
});
