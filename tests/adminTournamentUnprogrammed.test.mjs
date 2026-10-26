import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  "supabase/migrations/20261012094500_admin_unprogram_tournament_matches.sql",
  "utf8",
);
const page = readFileSync(
  "src/features/admin/tournaments/pages/AdminTournamentReschedulePage.tsx",
  "utf8",
);
const panel = readFileSync(
  "src/features/admin/tournaments/components/AdminTournamentUnprogrammedPanel.tsx",
  "utf8",
);

test("la déprogrammation libère planning et calendrier sans perdre le match", () => {
  const section = sql
    .split("create function public.admin_unprogram_tournament_match")[1]
    .split(
      "create function public.admin_list_unprogrammed_tournament_matches",
    )[0];
  assert.match(section, /tournament_match_results/);
  assert.match(section, /tournament_reschedule_active_matches/);
  assert.match(section, /publication_status='draft'/);
  assert.match(section, /delete from public.calendar_occupations/);
  assert.match(section, /delete from public.tournament_match_planning/);
  assert.doesNotMatch(section, /delete from public.tournament_matches/);
});

test("la programmation restaure une occupation future", () => {
  const section = sql.split(
    "create function public.admin_reprogram_tournament_match",
  )[1];
  assert.match(section, /absolute_start<=now\(\)/);
  assert.match(section, /calendar_occupations/);
  assert.match(section, /insert into public.tournament_match_planning/);
  assert.match(section, /perform public.sync_event_occupations/);
  assert.match(section, /delete from public.tournament_unprogrammed_matches/);
});

test("les reports montrent les parties à programmer", () => {
  assert.match(page, /AdminTournamentUnprogrammedPanel/);
  assert.match(panel, /Déprogrammer \/ libérer le créneau/);
  assert.match(panel, /Parties à programmer/);
  assert.match(panel, /Confirmer la programmation/);
});


test("le PDF des parties à reprogrammer regroupe tous les tournois et séries", () => {
  assert.match(panel, /Exporter la liste en PDF/);
  assert.match(panel, /printPendingMatches\(pending\)/);
  assert.match(panel, /@page \{ size: A4 portrait/);
  assert.match(panel, /grouped\.get\(match\.tournamentName\)/);
  assert.match(panel, /match\.reason/);
  assert.match(panel, /window\.print\(\)/);
});
