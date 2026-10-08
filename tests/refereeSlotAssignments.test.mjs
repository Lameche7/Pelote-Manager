import { readFileSync } from 'node:fs';
import test from 'node:test';
import assert from 'node:assert/strict';

const migration = readFileSync(
  new URL('../supabase/migrations/20261008194500_referee_slot_assignments_phase1.sql', import.meta.url),
  'utf8',
);

test('referee slot identity is independent of tournament/championship match ids', () => {
  const table = migration.split('create table if not exists public.referee_slot_assignments (')[1].split(');')[0];
  assert.match(table, /resource_id uuid not null/);
  assert.match(table, /starts_at timestamptz not null/);
  assert.match(table, /ends_at timestamptz not null/);
  assert.doesNotMatch(table, /tournament_match_id|championship_match_id/);
});

test('migration cannot silently reassign collisions to another slot', () => {
  assert.match(migration, /count\(\*\) over \(partition by c\.resource_id,c\.starts_at\) competing/);
  assert.match(migration, /from unambiguous where competing=1/);
  assert.match(migration, /referee_slot_migration_audit/);
});

test('new slot assignments are not accessible directly via public Data API', () => {
  assert.match(migration, /enable row level security/);
  assert.match(migration, /revoke all on public\.referee_slot_assignments from public, anon, authenticated/);
});
