import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  buildErrebotIdentityMatchPayload,
  summarizeErrebotIdentityMatches,
} from "../.test-dist/src/features/admin/tournaments/domain/errebotIdentityMatching.js";

test("le payload de rapprochement contient exactement deux joueurs par équipe", () => {
  const parsed = {
    parserVersion: "errebot-pdf-v1",
    teams: [
      {
        externalId: "100",
        series: "1re Série",
        players: [
          { firstName: "Alice", lastName: "Alpha", phone: "0600000001" },
          { firstName: "Bob", lastName: "Bravo", phone: "0600000002" },
        ],
      },
      {
        externalId: "101",
        series: "1re Série",
        players: [
          { firstName: "Chloe", lastName: "Charlie", phone: "0600000003" },
          { firstName: "Dan", lastName: "Delta", phone: "0600000004" },
        ],
      },
    ],
    pools: [],
    fixtures: [],
    emptySlotCount: 0,
    poolSize3Count: 0,
    series: [],
    issues: [],
  };

  assert.deepEqual(buildErrebotIdentityMatchPayload(parsed), [
    {
      externalKey: "100:1",
      teamExternalId: "100",
      playerIndex: 1,
      firstName: "Alice",
      lastName: "Alpha",
      phone: "0600000001",
    },
    {
      externalKey: "100:2",
      teamExternalId: "100",
      playerIndex: 2,
      firstName: "Bob",
      lastName: "Bravo",
      phone: "0600000002",
    },
    {
      externalKey: "101:1",
      teamExternalId: "101",
      playerIndex: 1,
      firstName: "Chloe",
      lastName: "Charlie",
      phone: "0600000003",
    },
    {
      externalKey: "101:2",
      teamExternalId: "101",
      playerIndex: 2,
      firstName: "Dan",
      lastName: "Delta",
      phone: "0600000004",
    },
  ]);
});

test("le résumé distingue vérifiés suggestions conflits et absents", () => {
  const base = {
    externalKey: "100:1",
    teamExternalId: "100",
    playerIndex: 1,
    firstName: "Alice",
    lastName: "Alpha",
    reason: "no_match",
    externalIdentityId: null,
    memberId: null,
    profileId: null,
    memberDisplayName: null,
    licenceNumber: null,
    clubId: null,
    clubName: null,
    linkedAccount: false,
    memberActive: false,
  };
  const matches = [
    { ...base, status: "verified" },
    { ...base, externalKey: "100:2", status: "suggested" },
    { ...base, externalKey: "101:1", status: "suggested" },
    { ...base, externalKey: "101:2", status: "conflict" },
    { ...base, externalKey: "102:1", status: "unmatched" },
  ];
  assert.deepEqual(summarizeErrebotIdentityMatches(matches), {
    verified: 1,
    suggested: 2,
    conflict: 1,
    unmatched: 1,
  });
});

const migrationPath =
  "../supabase/migrations/20260831113000_errebot_identity_matching.sql";

test("le RPC de rapprochement reste une prévisualisation sans écriture", async () => {
  const migration = await readFile(
    new URL(migrationPath, import.meta.url),
    "utf8",
  );
  assert.match(migration, /admin_preview_errebot_identity_matches/);
  assert.match(
    migration,
    /has_club_permission\(target_club_id, 'tournaments\.manage'\)/,
  );
  assert.match(migration, /normalize_member_identity/);
  assert.match(migration, /normalize_tournament_phone/);
  assert.match(migration, /reused_verified_identity/);
  assert.match(migration, /exact_name_phone/);
  assert.match(migration, /match_status := 'suggested'/);
  assert.match(migration, /phone_name_conflict/);
  assert.doesNotMatch(
    migration,
    /insert into public\.tournament_external_player_identities|update public\.tournament_external_player_identities/,
  );
});

test("le RPC n'expose ni téléphone ni email dans sa réponse", async () => {
  const migration = await readFile(
    new URL(migrationPath, import.meta.url),
    "utf8",
  );
  const responseStart = migration.indexOf(
    "result := result || jsonb_build_array(jsonb_build_object(",
  );
  const responseEnd = migration.indexOf("));", responseStart);
  assert.ok(responseStart >= 0 && responseEnd > responseStart);
  const responseBlock = migration.slice(responseStart, responseEnd);
  assert.doesNotMatch(responseBlock, /'email'\s*,/);
  assert.doesNotMatch(responseBlock, /'phone'\s*,/);
  assert.match(
    migration,
    /revoke all on function public\.admin_preview_errebot_identity_matches\(jsonb\)[\s\S]*from public, anon/,
  );
  assert.match(
    migration,
    /grant execute on function public\.admin_preview_errebot_identity_matches\(jsonb\)[\s\S]*to authenticated/,
  );
});

test("le RPC rejette un index absent et priorise un téléphone déjà attribué", async () => {
  const migration = await readFile(
    new URL(migrationPath, import.meta.url),
    "utf8",
  );
  assert.match(migration, /or player_index is null/);
  const phoneConflict = migration.indexOf(
    "elsif phone_conflict_count > 0 then",
  );
  const uniqueName = migration.indexOf("elsif name_count = 1 then");
  assert.ok(phoneConflict >= 0);
  assert.ok(uniqueName >= 0);
  assert.ok(phoneConflict < uniqueName);
});
