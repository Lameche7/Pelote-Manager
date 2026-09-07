import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationUrl = new URL(
  "../supabase/migrations/20260906190000_add_championship_result_submissions.sql",
  import.meta.url,
);
const serviceUrl = new URL(
  "../src/features/user-space/championships/services/myChampionshipsService.ts",
  import.meta.url,
);
const pageUrl = new URL(
  "../src/features/user-space/championships/pages/MyChampionshipsPage.tsx",
  import.meta.url,
);

const read = (url) => readFile(url, "utf8");

test("une proposition joueur reste séparée du résultat officiel", async () => {
  const sql = await read(migrationUrl);

  assert.match(sql, /create table public\.championship_result_submissions/);
  assert.match(sql, /score_team1 integer not null/);
  assert.match(sql, /official_score_team1 integer/);
  assert.doesNotMatch(
    sql,
    /update public\.championship_matches[\s\S]*set score_team1/i,
  );
});

test("seul un joueur lié à une équipe de la rencontre peut proposer un score", async () => {
  const sql = await read(migrationUrl);

  assert.match(
    sql,
    /create or replace function public\.submit_my_championship_result/,
  );
  assert.match(sql, /player\.profile_id = actor_id/);
  assert.match(sql, /player\.link_status in \('claimed', 'verified'\)/);
  assert.match(sql, /team\.id in \(match_row\.team1_id, match_row\.team2_id\)/);
  assert.doesNotMatch(sql, /email|phone|telephone|tel_responsable/i);
});

test("une donnée officielle confirme ou met en conflit la proposition", async () => {
  const sql = await read(migrationUrl);

  assert.match(
    sql,
    /create or replace function public\.championship_reconcile_result_submissions/,
  );
  assert.match(sql, /'confirmed_official'/);
  assert.match(sql, /'conflict_official'/);
  assert.match(
    sql,
    /before update of score_team1, score_team2[\s\S]*on public\.championship_matches/,
  );
});

test("les propositions ne sont pas exposées directement aux clients", async () => {
  const sql = await read(migrationUrl);

  assert.match(
    sql,
    /alter table public\.championship_result_submissions enable row level security/,
  );
  assert.match(
    sql,
    /revoke all on table public\.championship_result_submissions from public, anon, authenticated/,
  );
  assert.match(
    sql,
    /grant execute on function public\.submit_my_championship_result\(uuid, integer, integer, text\) to authenticated/,
  );
});

test("le service charge et envoie les propositions de résultat", async () => {
  const service = await read(serviceUrl);

  assert.match(service, /get_my_championship_result_submissions/);
  assert.match(service, /submit_my_championship_result/);
  assert.match(service, /target_score_mine/);
  assert.match(service, /target_score_opponent/);
});

test("l’interface distingue proposition et résultat officiel", async () => {
  const page = await read(pageUrl);

  assert.match(page, /Saisir le résultat/);
  assert.match(page, /En attente de confirmation par la source officielle/);
  assert.match(page, /La proposition de votre équipe a été confirmée/);
  assert.match(page, /Résultat officiel différent/);
  assert.match(
    page,
    /Cette proposition n’écrase\s+jamais le résultat officiel/,
  );
});
