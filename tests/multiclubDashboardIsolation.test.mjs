import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(
  new URL("../src/features/admin/pages/AdminPage.tsx", import.meta.url),
  "utf8",
);
const service = readFileSync(
  new URL(
    "../src/features/admin/services/adminDashboardService.ts",
    import.meta.url,
  ),
  "utf8",
);
const shell = readFileSync(
  new URL("../src/features/admin/components/AdminShell.tsx", import.meta.url),
  "utf8",
);
const brandingService = readFileSync(
  new URL(
    "../src/features/home/services/clubBrandingService.ts",
    import.meta.url,
  ),
  "utf8",
);
const layout = readFileSync(
  new URL("../src/app/layouts/MainLayout.tsx", import.meta.url),
  "utf8",
);

const clubAdminService = readFileSync(
  new URL(
    "../src/features/admin/club/services/clubAdminService.ts",
    import.meta.url,
  ),
  "utf8",
);

const brandingUploadService = readFileSync(
  new URL(
    "../src/features/admin/club/services/clubBrandingUploadService.ts",
    import.meta.url,
  ),
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
  assert.match(shell, /Aucune donnée administrative ne sera chargée/);
});

test("le libellé de statistiques ne suppose pas le trinquet de Lourdes", () => {
  assert.doesNotMatch(page, /Championnats · Robert Cathala/);
  assert.match(page, /Championnats · installations du club/);
});

test("la navigation admin conserve le club visuel sans l’utiliser comme permission", () => {
  assert.match(shell, /params\.set\("club", visualClubSlug\)/);
  assert.match(shell, /params\.set\("adminClubId", requestedClubId\)/);
  assert.match(shell, /if \(requestedClubId\) \{/);
  assert.match(layout, /withClubPreview/);
});

test("un aperçu visuel étranger bloque les données administratives implicites", () => {
  assert.match(shell, /if \(visualClubSlug && !requestedClubId\)/);
  assert.match(shell, /Administration du club sélectionné indisponible/);
  assert.match(shell, /if \(requestedClubId\) \{/);
  assert.ok(
    shell.indexOf("if (requestedClubId) {") <
      shell.indexOf("<AdminAccessProvider"),
    "Le blocage inter-clubs doit précéder le chargement des accès métier",
  );
});

test("un échec de branding étranger ne réaffiche pas le club historique", () => {
  assert.match(layout, /clubBrandingService\.unavailableFallback/);
  assert.match(brandingService, /name: "Club indisponible"/);
  assert.match(brandingService, /primaryColor: "#374151"/);
  assert.match(layout, /const safeFallback = clubSlug/);
  assert.match(layout, /if \(active\) setBranding\(safeFallback\)/);
});

test("le service de branding ne réutilise pas les valeurs Lourdes pour un club étranger", () => {
  assert.match(
    brandingService,
    /const defaults = clubSlug \? foreignFallback : fallback/,
  );
  assert.match(brandingService, /if \(clubSlug && \(!row\.name/);
  assert.match(brandingService, /name: value\(row\.name, defaults\.name\)/);
});

test("un accès direct à un aperçu étranger ne montre pas Lourdes au premier rendu", () => {
  assert.match(
    layout,
    /useState\(\(\) =>\s*new URLSearchParams\(window\.location\.search\)\.has\("club"\)/,
  );
  assert.match(layout, /\? clubBrandingService\.unavailableFallback/);
});

test("les informations ne peuvent pas modifier un autre club par identifiant", () => {
  assert.match(
    clubAdminService,
    /const authorizedClubId = await currentClubId\(\)/,
  );
  assert.match(clubAdminService, /club\.id !== authorizedClubId/);
  assert.match(clubAdminService, /\.eq\("id", authorizedClubId\)/);
  assert.match(clubAdminService, /\.select\("id"\)/);
  assert.match(clubAdminService, /data\.length !== 1/);
  assert.match(
    clubAdminService,
    /Modification interdite pour le club sélectionné/,
  );
});

test("le nettoyage des images vérifie également le club autorisé", () => {
  const cleanup = brandingUploadService.split("async discardUploadedImage(")[1];
  assert.ok(cleanup);
  assert.match(cleanup, /admin_current_club_id/);
  assert.match(cleanup, /authorizedClubId !== clubId/);
  assert.match(cleanup, /storage\.from\(BUCKET\)\.remove/);
});

test("la lecture explicite des informations exige une habilitation métier", () => {
  const scopedRead = clubAdminService.split("async getClubForAuthorizedMembership(")[1];
  assert.ok(scopedRead);
  assert.match(scopedRead, /adminAccessService\.getAccessForClub\(clubId\)/);
  assert.match(scopedRead, /\.eq\("id", clubId\)/);
  assert.match(scopedRead, /data\.id !== clubId/);
});
