import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

test("la préparation du premier administrateur est une simulation isolée", async () => {
  const [sql, component, dashboard] = await Promise.all([
    read(
      "../supabase/platform/migrations/20261104213000_first_admin_dry_run.sql",
    ),
    read(
      "../src/features/platform/components/PlatformFirstAdminDryRunPanel.tsx",
    ),
    read("../src/features/platform/pages/PlatformDashboardPage.tsx"),
  ]);
  assert.match(sql, /not public\.is_platform_admin\(\)/);
  assert.match(sql, /source_registration_request_id is null/);
  assert.match(sql, /registered_club\.slug not like 'test-%'/);
  assert.match(sql, /\.invalid/);
  assert.match(sql, /enable row level security/);
  assert.match(sql, /revoke all on public\.platform_first_admin_dry_runs/);
  assert.match(sql, /platform_prepare_first_admin_dry_run/);
  assert.match(sql, /platform_list_first_admin_dry_runs/);
  assert.doesNotMatch(
    sql,
    /insert into (?:auth\.users|public\.club_memberships)/i,
  );
  assert.doesNotMatch(sql, /insert into public\.platform_provisioning_jobs/i);
  assert.match(component, /aucune invitation/);
  assert.match(component, /Aucun compte ou accès n'a été créé/);
  assert.match(component, /platform_prepare_first_admin_dry_run/);
  assert.match(dashboard, /<PlatformFirstAdminDryRunPanel clubs=\{clubs\} \/>/);
});
