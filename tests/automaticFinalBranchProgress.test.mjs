import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const sql = readFileSync(
  new URL(
    "../supabase/migrations/20261117170000_auto_advance_independent_final_branches.sql",
    import.meta.url,
  ),
  "utf8",
);

test("the rollout is restricted to Lourdes and explicitly opt-in per tournament", () => {
  assert.match(sql, /finals_auto_advance_enabled boolean not null default false/);
  assert.match(sql, /3de17177-a915-404f-8a6e-14bf42158982/);
  assert.match(sql, /188029a8-3e6a-41cd-821f-01984a703552/);
  assert.match(sql, /and t\.finals_auto_advance_enabled/);
  assert.match(sql, /and t\.status in \('planning_published','in_progress'\)/);
});

test("each bracket node waits for its own two validated feeding matches, not the entire round", () => {
  assert.match(sql, /previous_order := node\.display_order\*2\+\(part-1\)/);
  assert.match(sql, /result\.match_id=m\.id and result\.status='validated'/);
  assert.match(sql, /array_length\(entrants,1\),0\)<>2/);
  assert.match(sql, /not exists \([\s\S]*?m\.final_round_number=n\.round_number/);
  assert.match(sql, /on conflict do nothing/);
  assert.match(sql, /when chosen_series\.finals_cross_pools and qualifier_count=6/);
  assert.match(sql, /array\[1,3,2,4\]/);
  assert.match(sql, /when chosen_series\.finals_cross_pools and qualifier_count=8/);
});

test("publication requires a valid future reserved slot and both teams available", () => {
  assert.match(sql, /join public\.tournament_match_planning p on p\.match_id=m\.id/);
  assert.match(sql, /not exists\(select 1 from public\.tournament_match_events me/);
  assert.match(sql, /\)>now\(\)/);
  assert.match(sql, /a\.team_id=m\.team_a_id/);
  assert.match(sql, /a\.team_id=m\.team_b_id/);
  assert.match(sql, /not exists \(\s*select 1 from public\.calendar_occupations occ/);
  assert.match(sql, /insert into public\.tournament_match_events\(match_id,event_id\)/);
  assert.match(sql, /public\.sync_event_occupations\(new_event_id\)/);
  assert.doesNotMatch(sql, /update public\.tournament_matches set team_a_id/);
});

test("automatic processing is private and only fires on finalized results", () => {
  assert.match(sql, /revoke all on function public\.auto_progress_independent_tournament_final_branches\(uuid,uuid\)/);
  assert.match(sql, /revoke all on function public\.after_validated_tournament_final_result_auto_progress\(\)/);
  assert.match(sql, /after insert or update of status on public\.tournament_match_results/);
  assert.match(sql, /if new\.status<>'validated' then return new/);
  assert.match(sql, /select m\.series_id into selected_series/);
  assert.match(sql, /and m\.phase='finals'/);
  assert.match(sql, /exception when others then/);
});
