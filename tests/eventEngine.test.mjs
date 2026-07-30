import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const migration = await readFile(
  "supabase/migrations/20260730000600_add_event_engine.sql",
  "utf8",
);
const service = await readFile(
  "src/features/admin/services/eventAdminService.ts",
  "utf8",
);

test("event engine is generic, normalized and club scoped", () => {
  for (const table of [
    "event_types",
    "events",
    "event_resources",
    "event_documents",
  ])
    assert.match(migration, new RegExp(`create table public.${table}`));
  assert.match(migration, /club_id uuid not null/);
  assert.match(migration, /references public\.reservable_resources/);
});

test("blocking published events use the shared occupation calendar", () => {
  assert.match(
    migration,
    /is_blocking and current_event\.publication_status = 'published'/,
  );
  assert.match(migration, /insert into public\.calendar_occupations/);
  assert.match(migration, /'club_event'/);
  assert.match(migration, /then current_event\.name else 'Indisponible'/);
});

test("legacy block RPCs accept manual closures only", () => {
  assert.match(migration, /occupation\.occupation_type='closure'/);
  assert.match(migration, /Blocage manuel introuvable/);
});

test("event writes lock resources, preflight conflicts and audit lifecycle changes", () => {
  assert.match(migration, /order by r\.id for update/);
  assert.match(migration, /Un terrain est déjà occupé pendant cette période/);
  assert.match(migration, /create table public\.event_audit_log/);
  for (const action of ["created", "updated", "archived", "deleted"])
    assert.match(migration, new RegExp(`'${action}'`));
});

test("duplication requires an explicit payload and always creates a safe draft", () => {
  assert.match(
    migration,
    /admin_duplicate_event\(target_id uuid,payload jsonb\)/,
  );
  assert.match(migration, /'publication_status','draft','is_blocking',false/);
});

test("administration service exposes the complete event lifecycle", () => {
  for (const method of [
    "listEvents",
    "getEvent",
    "createEvent",
    "updateEvent",
    "duplicateEvent",
    "archiveEvent",
    "deleteEvent",
  ])
    assert.match(service, new RegExp(`async ${method}`));
});
