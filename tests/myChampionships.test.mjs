import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260906183000_add_my_championships.sql",
  import.meta.url,
);
const routesUrl = new URL("../src/shared/config/routes.ts", import.meta.url);
const routerUrl = new URL("../src/app/router.tsx", import.meta.url);
const shellUrl = new URL(
  "../src/features/user-space/components/UserSpaceShell.tsx",
  import.meta.url,
);
const pageUrl = new URL(
  "../src/features/user-space/championships/pages/MyChampionshipsPage.tsx",
  import.meta.url,
);

const read = (url) => readFile(url, "utf8");

test("mes championnats repose uniquement sur l’identité sportive liée au compte", async () => {
  const sql = await read(migrationUrl);

  assert.match(sql, /player\.profile_id = auth\.uid\(\)/);
  assert.match(sql, /player\.link_status in \('claimed', 'verified'\)/);
  assert.doesNotMatch(sql, /email/i);
  assert.doesNotMatch(sql, /phone|telephone|tel_responsable/i);
});

test("le rang affiché reste le rang officiel importé", async () => {
  const sql = await read(migrationUrl);

  assert.match(sql, /coalesce\(standing\.rank, team\.source_rank\)/);
  assert.match(sql, /coalesce\(pool_standing\.rank, pool_team\.source_rank\)/);
  assert.match(sql, /score_difference/);
  assert.doesNotMatch(
    sql,
    /ranking_points|qualifier_count|minimum_win_margin/i,
  );
});

test("le joueur reçoit uniquement ses équipes et leurs rencontres", async () => {
  const sql = await read(migrationUrl);

  assert.match(
    sql,
    /create or replace function public\.get_my_championships\(\)/,
  );
  assert.match(sql, /security definer/);
  assert.match(sql, /mine\.team_id in \(match\.team1_id, match\.team2_id\)/);
  assert.match(
    sql,
    /grant execute on function public\.get_my_championships\(\) to authenticated/,
  );
});

test("l’espace personnel expose la route Mes championnats", async () => {
  const [routes, router, shell] = await Promise.all([
    read(routesUrl),
    read(routerUrl),
    read(shellUrl),
  ]);

  assert.match(routes, /myChampionships: "\/mon-espace\/championnats"/);
  assert.match(router, /path: ROUTES\.myChampionships/);
  assert.match(router, /<MyChampionshipsPage \/>/);
  assert.match(shell, /to=\{ROUTES\.myChampionships\}/);
  assert.match(shell, /Mes championnats/);
});

test("l’interface expose les classements officiels et la navigation joueur", async () => {
  const page = await read(pageUrl);

  assert.match(page, /Classements officiels/);
  assert.match(page, /Ma poule/);
  assert.match(page, /Toutes les poules/);
  assert.match(page, /Classement général/);
  assert.match(page, /Zone de qualification directe/);
  assert.match(page, /Zone barrage/);
  assert.match(page, /Pelote Manager ne recalcule pas les règles de classement/);
  assert.match(page, /Prochaine partie/);
  assert.match(page, /Dernier résultat/);
});
