import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import assert from 'node:assert/strict';
const sql=name=>readFileSync(new URL('../supabase/migrations/'+name,import.meta.url),'utf8');
test('workspace binds arbiters to current match slot',()=>{
 const text=sql('20261008200000_refereeing_slot_workspace.sql');
 assert.match(text,/refereeing_current_match_slot\(x.source_type,x.match_id\)/);
 assert.match(text,/join public.referee_slot_assignments ra/);
 assert.doesNotMatch(text,/join public.referee_assignments ra/);
});
test('result permissions follow slots for both competitions',()=>{
 for(const name of ['20261008200500_referee_tournament_slot_result.sql','20261008201000_referee_championship_slot_result.sql','20261008201500_referee_slot_score_context.sql']){
  const text=sql(name);
  assert.match(text,/public.refereeing_current_match_slot/);
  assert.match(text,/public.referee_slot_assignments/);
  assert.doesNotMatch(text,/public.referee_assignments/);
 }
});
test('statistics and calendar reflect covered slots',()=>{
 for(const name of ['20261008202000_refereeing_slot_participation.sql','20261008202500_referee_slot_calendar_intervals.sql']){
  const text=sql(name);
  assert.match(text,/public.referee_slot_assignments/);
  assert.doesNotMatch(text,/public.referee_assignments/);
 }
});
