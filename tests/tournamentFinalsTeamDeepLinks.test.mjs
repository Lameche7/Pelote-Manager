import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(file, import.meta.url), "utf8");

test("les liens de mon espace ciblent la bonne équipe en phase finale", async () => {
  const [space, detail, editor] = await Promise.all([
    read("../src/features/user-space/tournaments/pages/MyTournamentsPage.tsx"),
    read("../src/features/tournaments/pages/TournamentDetailPage.tsx"),
    read(
      "../src/features/tournaments/components/TournamentFinalsAvailabilityEditor.tsx",
    ),
  ]);
  assert.match(
    space,
    /#disponibilites-finales-\$\{tournament\.team\.id\}/,
  );
  assert.match(detail, /hash\.startsWith\("#disponibilites-finales-"\)/);
  assert.match(detail, /linkedFinals\.some\(\(team\) => team\.teamId === targetTeamId\)/);
  assert.match(detail, /document\.getElementById\(targetId\)/);
  assert.match(editor, /id=\{`disponibilites-finales-\$\{registration\.teamId\}`\}/);
});
