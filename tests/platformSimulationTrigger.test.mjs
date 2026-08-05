import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";

const migration = fs.readFileSync(
  "supabase/platform/migrations/20260805030000_add_simulation_worker_claim.sql",
  "utf8",
);
const registryClient = fs.readFileSync(
  "workers/platform-provisioner/platformRegistryClient.mjs",
  "utf8",
);
const runner = fs.readFileSync(
  "workers/platform-provisioner/runOnce.mjs",
  "utf8",
);
const endpoint = fs.readFileSync(
  "api/platform-provisioner-simulation.mjs",
  "utf8",
);

test("la revendication de simulation filtre le slug avant de prendre un bail", () => {
  assert.match(
    migration,
    /platform_worker_claim_next_simulation_provisioning/,
  );
  assert.match(migration, /clubs\.slug like normalized_slug_prefix \|\| '%'/);
  assert.match(migration, /auth\.role\(\) <> 'service_role'/);
  assert.match(migration, /for update of jobs skip locked/i);
  assert.match(migration, /grant execute[\s\S]*to service_role/i);
  assert.doesNotMatch(migration, /grant execute[\s\S]*to authenticated/i);
});

test("le mode simulation ne revendique jamais le prochain job général", () => {
  assert.match(registryClient, /claimNextSimulationJob/);
  assert.match(
    registryClient,
    /platform_worker_claim_next_simulation_provisioning/,
  );
  assert.match(
    runner,
    /provider\.mode === "simulation"[\s\S]*claimNextSimulationJob/,
  );
});

test("le déclencheur serveur exige un super administrateur et force la simulation", () => {
  assert.match(endpoint, /platform_is_admin/);
  assert.match(endpoint, /authorization: `Bearer \$\{accessToken\}`/);
  assert.match(endpoint, /PLATFORM_PROVISIONER_MODE: "simulation"/);
  assert.match(
    endpoint,
    /PLATFORM_PROVISIONER_SIMULATION_ACK: SIMULATION_ACK/,
  );
  assert.match(
    endpoint,
    /PLATFORM_PROVISIONER_SIMULATION_SLUG_PREFIX: "simulation-"/,
  );
  assert.doesNotMatch(endpoint, /SUPABASE_MANAGEMENT|VERCEL_TOKEN|mode:\s*request/i);
});

test("la page technique n’envoie jamais la clé service_role au navigateur", () => {
  const renderPageBody = endpoint.match(
    /function renderPage\(\) \{([\s\S]*?)\n\}\n\nexport default/,
  )?.[1];

  assert.ok(renderPageBody);
  assert.doesNotMatch(
    renderPageBody,
    /PLATFORM_SUPABASE_SERVICE_ROLE_KEY|service_role|sb_secret_/i,
  );
  assert.match(renderPageBody, /pelote-manager-platform-auth/);
});
