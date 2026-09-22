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
  assert.match(
    page,
    /Pelote Manager ne recalcule pas les règles de classement/,
  );
  assert.match(page, /Prochaine partie/);
  assert.match(page, /Dernier résultat/);
});


test("les rencontres indiquent domicile extérieur et la composition adverse", async () => {
  const [page, service, migration] = await Promise.all([
    read(pageUrl),
    read(
      new URL(
        "../src/features/user-space/championships/services/myChampionshipsService.ts",
        import.meta.url,
      ),
    ),
    read(
      new URL(
        "../supabase/migrations/20260922103000_championship_home_away_and_opponent_details.sql",
        import.meta.url,
      ),
    ),
  ]);

  assert.match(page, /À domicile/);
  assert.match(page, /À l’extérieur/);
  assert.match(page, /Club : \{match\.opponentClubName\}/);
  assert.match(page, /match\.opponentPlayers\.map/);
  assert.match(service, /opponentClubName/);
  assert.match(service, /opponentPlayers/);
  assert.match(migration, /'opponent_club_name'/);
  assert.match(migration, /'opponent_players'/);
});


test("les championnats utilisent le responsable d'équipe et restent stables en largeur", async () => {
  const [page, service, styles, migration] = await Promise.all([
    read(pageUrl),
    read(new URL("../src/features/user-space/championships/services/myChampionshipsService.ts", import.meta.url)),
    read(new URL("../src/features/user-space/championships/pages/MyChampionshipsPage.css", import.meta.url)),
    read(new URL("../supabase/migrations/20260922110000_add_championship_team_responsible_contacts.sql", import.meta.url)),
  ]);

  assert.match(page, /Responsable/);
  assert.match(page, /opponentResponsibleName/);
  assert.match(page, /opponentResponsiblePhone/);
  assert.doesNotMatch(page, /Téléphone non disponible/);
  assert.match(service, /opponentResponsibleName/);
  assert.match(service, /opponentResponsiblePhone/);
  assert.doesNotMatch(service, /get_my_championship_player_contacts/);
  assert.doesNotMatch(styles, /\.my-championships\s*\{[^}]*overflow-x:\s*hidden/s);
  assert.match(styles, /\.my-championships__table-scroll\s*\{[^}]*overflow-x:\s*auto/s);
  assert.match(styles, /overflow-wrap: anywhere/);
  assert.match(migration, /responsible_name text/);
  assert.match(migration, /responsible_phone text/);
  assert.match(migration, /admin_update_championship_team_contacts/);
});
