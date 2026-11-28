import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(
  new URL(
    "../src/features/platform/components/PlatformClubSwitcher.tsx",
    import.meta.url,
  ),
  "utf8",
);

test("la préférence visuelle appartient au compte et non au navigateur seul", () => {
  assert.match(source, /pilotoki-selected-club:\$\{user\.id\}/);
  assert.match(source, /localStorage\.getItem\(preferenceKey\)/);
  assert.match(source, /localStorage\.setItem\(preferenceKey, slug\)/);
  assert.match(source, /!user \|\| !isAuthenticated \|\| isLoading/);
});

test("une préférence doit exister dans le catalogue serveur", () => {
  assert.match(source, /supabase\.rpc\("list_network_clubs_v3"\)/);
  assert.match(
    source,
    /available\.some\(\(club\) => club\.slug === remembered\)/,
  );
  assert.match(source, /localStorage\.removeItem\(preferenceKey\)/);
});

test("le club explicite est prioritaire sur la préférence", () => {
  assert.match(source, /if \(activeSlug\) \{/);
  assert.match(source, /next\.set\("club", defaultSlug\)/);
  assert.match(source, /location\.pathname !== ROUTES\.home/);
});

test("la gestion centrale reste réservée au rôle vérifié", () => {
  assert.match(source, /platform_is_admin/);
  assert.match(source, /roleError \|\| allowed !== true/);
  assert.match(source, /identityLinked && clubs\.some/);
  assert.doesNotMatch(source, /service_role/);
});

test("la restauration publique efface le contexte admin précédent", () => {
  assert.match(source, /next\.has\("adminClubId"\)/);
  assert.match(source, /next\.delete\("adminClubId"\)/);
  assert.match(source, /replace: true/);
});

test("changer de club ouvre une nouvelle URL publique sans contexte admin", () => {
  assert.match(
    source,
    /publicClubs\.some\(\(club\) => club\.slug === slug\)/,
  );
  assert.match(source, /navigate\(\x60\$\{ROUTES\.home\}\?club=/);
  assert.match(source, /Le club sélectionné ne modifie pas vos habilitations/);
});
