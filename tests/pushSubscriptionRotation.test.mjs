import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const migrationPath =
  "../supabase/migrations/20260816221000_prevent_duplicate_push_subscriptions.sql";
const servicePath =
  "../src/features/notifications/services/pushNotificationService.ts";

test(
  "la rotation d endpoint désactive uniquement l ancien endpoint connu de cet appareil",
  async () => {
    const migration = await read(migrationPath);

    assert.match(migration, /register_push_subscription_v2/i);
    assert.match(migration, /target_previous_endpoint text default null/i);
    assert.match(
      migration,
      /previous_endpoint is distinct from current_endpoint/i,
    );
    assert.match(
      migration,
      /subscription\.profile_id = actor_id[\s\S]*subscription\.endpoint = previous_endpoint[\s\S]*subscription\.is_active/i,
    );
    assert.doesNotMatch(
      migration,
      /where subscription\.profile_id = actor_id[\s\S]{0,200}subscription\.platform =/i,
    );
  },
);

test(
  "le navigateur mémorise son endpoint précédent et le transmet atomiquement au backend",
  async () => {
    const service = await read(servicePath);

    assert.match(service, /pelote-manager:push:last-endpoint/);
    assert.match(
      service,
      /localStorage\.getItem\(LAST_PUSH_ENDPOINT_STORAGE_KEY\)/,
    );
    assert.match(
      service,
      /localStorage\.setItem\(LAST_PUSH_ENDPOINT_STORAGE_KEY, endpoint\)/,
    );
    assert.match(service, /register_push_subscription_v2/);
    assert.match(service, /target_previous_endpoint: previousEndpoint/);
    assert.match(service, /rememberLastPushEndpoint\(subscription\.endpoint\)/);
  },
);

test(
  "la désactivation volontaire oublie l endpoint local sans casser le multi-appareil",
  async () => {
    const service = await read(servicePath);

    assert.match(service, /forgetLastPushEndpoint\(subscription\.endpoint\)/);
    assert.doesNotMatch(service, /disable.*platformLabel\(\)/is);
  },
);
