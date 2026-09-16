import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migration = await readFile(
  new URL(
    "../supabase/migrations/20260916102000_allow_players_in_multiple_tournament_series.sql",
    import.meta.url,
  ),
  "utf8",
);

test("l'import autorise un licencié dans plusieurs séries", () => {
  assert.match(
    migration,
    /group by player\.member_id, team\.series_id/,
  );
  assert.match(
    migration,
    /A verified member appears in more than one team in the same series/,
  );
});

test("la propagation d'identité ne compare que les équipes de la même série", () => {
  assert.match(
    migration,
    /group by affected_player\.tournament_id, affected_team\.series_id/,
  );
  assert.match(
    migration,
    /other_team\.series_id = affected_team\.series_id/,
  );
});

test("la confirmation joueur ne bloque que dans la même série", () => {
  assert.match(
    migration,
    /other_team\.series_id = selected_team\.series_id/,
  );
  assert.match(
    migration,
    /Account already represents another player in this tournament series/,
  );
});
