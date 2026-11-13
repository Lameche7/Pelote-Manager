import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL("../src/features/admin/pages/AdminPage.tsx", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL("../src/features/admin/services/adminDashboardService.ts", import.meta.url),
  "utf8",
);
const shell = readFileSync(
  new URL("../src/features/admin/components/AdminShell.tsx", import.meta.url),
  "utf8",
);
const layout = readFileSync(
  new URL("../src/app/layouts/MainLayout.tsx", import.meta.url),
  "utf8",
);

test("le tableau de bord efface les données avant un nouveau chargement", () => {
  assert.match(page, /setDashboard\(null\);\s*setLoading\(true\)/);
  assert.match(page, /requestId !== requestSequence\.current/);
  assert.match(page, /\[access\?\.clubId\]/);
  assert.match(page, /requestSequence\.current \+= 1/);
});

test("aucune requête explicite ne retombe sur le club historique", () => {
  assert.match(service, /getDashboardForClub: loadExplicitClubDashboard/);
  assert.match(service, /if \(clubId\) \{\s*throw new Error/);
  for (const name of [
    "admin_get_dashboard",
    "admin_dashboard_match_counts",
    "admin_monthly_match_report",
  ]) {
    assert.match(service, new RegExp("supabase\\.rpc\\([\\s\\S]*?" + name));
  }
  assert.match(shell, /if \(requestedClubId\) \{/);
});

test("le libellé de statistiques ne suppose pas le trinquet de Lourdes", () => {
  assert.doesNotMatch(page, /Championnats · Robert Cathala/);
  assert.match(page, /Championnats · installations du club/);
});

test(
  "la navigation admin conserve le club visuel sans l’utiliser comme permission",
  () => {
  assert.match(shell, /params\.set\("club", visualClubSlug\)/);
  assert.match(shell, /params\.set\("adminClubId", requestedClubId\)/);
  assert.match(shell, /if \(requestedClubId\) \{/);
    assert.match(layout, /withClubPreview/);
  },
);

test(
  "un aperçu visuel étranger bloque les données administratives implicites",
  () => {
    assert.match(shell, /if \(visualClubSlug && !requestedClubId\)/);
    assert.match(shell, /Administration du club sélectionné indisponible/);
    assert.match(shell, /if \(requestedClubId\) \{/);
  },
);
