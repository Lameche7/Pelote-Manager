import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260816221000_prevent_duplicate_push_subscriptions.sql";
const servicePath =
  "../src/features/notifications/services/pushNotificationService.ts";

test("la rotation désactive l ancien endpoint connu", async () => {
  const migration = await read(migrationPath);
  const rotatesEndpoint =
    /previous_endpoint is distinct from current_endpoint/i;

  assert.match(migration, /register_push_subscription_v2/i);
  assert.match(migration, /target_previous_endpoint text default null/i);
  assert.match(migration, rotatesEndpoint);
  assert.match(migration, /subscription\.profile_id = actor_id/);
  assert.match(migration, /subscription\.endpoint = previous_endpoint/);
});

test("le navigateur transmet l endpoint précédent", async () => {
  const service = await read(servicePath);

  assert.match(service, /pelote-manager:push:last-endpoint/);
  assert.match(service, /localStorage\.getItem/);
  assert.match(service, /localStorage\.setItem/);
  assert.match(service, /register_push_subscription_v2/);
  assert.match(service, /target_previous_endpoint: previousEndpoint/);
  assert.match(service, /rememberLastPushEndpoint/);
});

test("la désactivation oublie l endpoint local", async () => {
  const service = await read(servicePath);

  assert.match(service, /forgetLastPushEndpoint/);
  assert.doesNotMatch(service, /disable.*platformLabel\(\)/is);
});
