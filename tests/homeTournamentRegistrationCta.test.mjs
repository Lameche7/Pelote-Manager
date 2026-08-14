import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) =>
  readFileSync(new URL(`../${path}`, import.meta.url), "utf8");

const homePage = read("src/features/home/pages/HomePage.tsx");
const homeTournaments = read(
  "src/features/home/components/HomeTournaments.tsx",
);
const tournamentDetail = read(
  "src/features/tournaments/pages/TournamentDetailPage.tsx",
);

test("the public homepage includes the tournament section", () => {
  assert.match(homePage, /HomeTournaments/);
  assert.match(homePage, /<HomeTournaments \/>/);
  assert.match(homeTournaments, /tournamentService\.listPublic\(\)/);
  assert.match(homeTournaments, /Tournois du club/);
});

test("an open tournament links directly to the registration anchor", () => {
  assert.match(homeTournaments, /registrations_open/);
  assert.match(homeTournaments, /#inscription/);
  assert.match(homeTournaments, /S’inscrire/);
  assert.match(tournamentDetail, /id="inscription"/);
});

test("homepage tournaments refresh without asking users to clear their cache", () => {
  assert.match(homeTournaments, /setInterval\(refresh, 60_000\)/);
  assert.match(homeTournaments, /window\.addEventListener\("focus", refresh\)/);
  assert.match(
    homeTournaments,
    /document\.addEventListener\("visibilitychange", refresh\)/,
  );
});
