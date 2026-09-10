import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const page = await readFile(
  "src/features/user-space/championships/pages/MyChampionshipsPage.tsx",
  "utf8",
);

test("les championnats archivés sont retirés de la liste principale", () => {
  assert.match(page, /championshipStatus !== "archived"/);
  assert.match(page, /currentChampionships\.map\(championshipCard\)/);
});

test("les archives sont regroupées et accessibles par saison", () => {
  assert.match(page, /const archivedBySeason = useMemo/);
  assert.match(page, /const historySeasons = useMemo/);
  assert.match(page, /selectedHistorySeason/);
  assert.match(page, />\s*Historique\s*</);
  assert.match(page, /Saisons terminées/);
});

test("un championnat archivé reste consultable sans saisie de résultat", () => {
  assert.match(
    page,
    /const readOnly = championship\.championshipStatus === "archived"/,
  );
  assert.match(page, /!readOnly && \(/);
  assert.match(page, /readOnly=\{readOnly\}/);
});
