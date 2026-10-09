import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(
  "src/features/user-space/championships/pages/MyChampionshipsPage.tsx",
  "utf8",
);

test("les championnats archivés sont retirés des parties courantes", () => {
  assert.match(page, /const currentChampionships = useMemo/);
  assert.match(page, /championshipStatus !== "archived"/);
  assert.match(page, /currentChampionships\.flatMap/);
  assert.match(page, /const archivedChampionships = useMemo/);
  assert.match(page, /championshipStatus === "archived"/);
});

test("les archives sont accessibles dans un historique repliable avec la saison", () => {
  assert.match(page, /archivedChampionships\.length > 0/);
  assert.match(page, /<details className="my-championships__history-block">/);
  assert.match(page, /Historique des saisons/);
  assert.match(page, /archivedChampionships\.map/);
  assert.match(page, /championship\.seasonLabel/);
});

test("les archives affichent les scores sans actions de saisie", () => {
  assert.match(page, /className="my-championships__archive-list"/);
  assert.match(page, /championship\.matches/);
  assert.match(page, /archivedScore\(match\)/);
  assert.match(page, /championship\.opponentLabel|match\.opponentLabel/);
});
