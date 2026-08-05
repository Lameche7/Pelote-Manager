export const PLATFORM_INSTALLATION_BUNDLE = Object.freeze({
  bundleVersion: "pr43-platform-2026-08-05.1",
  purpose: "central-control-plane",
  migrations: Object.freeze([
    "supabase/platform/migrations/20260804010000_create_platform_registry.sql",
    "supabase/platform/migrations/20260804020000_add_platform_provisioning_jobs.sql",
    "supabase/platform/migrations/20260804030000_add_provisioning_worker_leases.sql",
    "supabase/platform/migrations/20260805010000_add_platform_cost_plans.sql",
    "supabase/platform/migrations/20260805020000_add_live_execution_confirmations.sql",
    "supabase/platform/migrations/20260805030000_add_simulation_worker_claim.sql",
  ]),
  bootstrap: "supabase/platform/bootstrap/01_attach_first_platform_admin.sql",
  runbook: "docs/runbooks/PLATFORM_CENTRAL_INSTALLATION.md",
});
