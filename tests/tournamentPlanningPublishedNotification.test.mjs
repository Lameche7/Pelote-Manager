import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260816213000_add_tournament_planning_published_notification.sql",
    import.meta.url,
  ),
  "utf8",
);

test("la publication du planning déclenche une notification joueurs", () => {
  assert.match(migration, /old\.status is distinct from 'planning_generated'/);
  assert.match(migration, /new\.status is distinct from 'planning_published'/);
  assert.match(migration, /'planning_published'/);
  assert.match(migration, /Planning publié : /);
});

test("la notification cible uniquement les participants réellement planifiés", () => {
  assert.match(migration, /from public\.tournament_team_players as player/);
  assert.match(migration, /from public\.tournament_matches as match/);
  assert.match(
    migration,
    /player\.team_id in \(match\.team_a_id, match\.team_b_id\)/,
  );
});

test("les joueurs extérieurs avec un compte Pelote Manager restent éligibles", () => {
  assert.match(
    migration,
    /lower\(btrim\(profile\.email\)\) = lower\(btrim\(player\.email\)\)/,
  );
  assert.match(migration, /profile_id_at_publication/);
});

test("le clic ouvre Mes tournois et aucune notification historique n'est rejouée", () => {
  assert.match(
    migration,
    /tournament_event\.event_kind = 'planning_published' then '\/mon-espace\/tournois'/,
  );
  assert.doesNotMatch(
    migration,
    /insert[\s\S]*from public\.tournaments[\s\S]*where[\s\S]*status = 'planning_published'/i,
  );
});

test("une panne du moteur de notification ne bloque pas la publication", () => {
  assert.match(migration, /exception[\s\S]*when others then[\s\S]*return new/);
});
