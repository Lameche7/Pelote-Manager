import assert from "node:assert/strict";
import test from "node:test";
import {
  ADMIN_DASHBOARD_PERMISSION,
  canAccessAdminDashboard,
} from "../.test-dist/src/features/admin/access/adminAccessRules.js";

test("masque l'administration en l'absence d'habilitation", () => {
  assert.equal(canAccessAdminDashboard(null), false);
  assert.equal(canAccessAdminDashboard({ permissions: [] }), false);
  assert.equal(
    canAccessAdminDashboard({ permissions: ["reservations.manage"] }),
    false,
  );
});

test("affiche l'administration uniquement avec la permission du tableau de bord", () => {
  assert.equal(ADMIN_DASHBOARD_PERMISSION, "admin.dashboard.read");
  assert.equal(
    canAccessAdminDashboard({ permissions: [ADMIN_DASHBOARD_PERMISSION] }),
    true,
  );
});
