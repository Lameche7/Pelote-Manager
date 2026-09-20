import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [migration, service, prompt, layout, claimMigration] = await Promise.all([
  readFile(
    new URL(
      "../supabase/migrations/20260920110000_detect_late_imported_participations.sql",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/features/auth/services/externalParticipationService.ts",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL(
      "../src/features/auth/components/ExternalParticipationPrompt.tsx",
      import.meta.url,
    ),
    "utf8",
  ),
  readFile(
    new URL("../src/app/layouts/MainLayout.tsx", import.meta.url),
    "utf8",
  ),
  readFile(
    new URL(
      "../supabase/migrations/20260903170000_external_identity_self_claim.sql",
      import.meta.url,
    ),
    "utf8",
  ),
]);

test("la recherche tardive dérive l'identité du profil authentifié", () => {
  assert.match(
    migration,
    /create or replace function public\.get_my_unclaimed_external_participations\(\)/,
  );
  assert.match(migration, /actor_id uuid := auth\.uid\(\)/);
  assert.match(migration, /from public\.profiles as profile/);
  assert.match(
    migration,
    /public\.find_external_participation_candidates\([\s\S]*actor_profile\.first_name,[\s\S]*actor_profile\.last_name/,
  );
  assert.match(
    migration,
    /revoke all on function public\.get_my_unclaimed_external_participations\(\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    migration,
    /grant execute on function public\.get_my_unclaimed_external_participations\(\)[\s\S]*to authenticated/,
  );
});

test("l'application vérifie les nouvelles participations au fil de la navigation", () => {
  assert.match(service, /get_my_unclaimed_external_participations/);
  assert.match(prompt, /externalParticipationService\.listUnclaimed\(\)/);
  assert.match(prompt, /location\.key/);
  assert.match(prompt, /Oui, c’est bien moi/);
  assert.match(prompt, /Plus tard/);
  assert.match(prompt, /externalParticipationService\.claim/);
  assert.match(layout, /<ExternalParticipationPrompt \/>/);
});

test("la confirmation reste volontaire et revalidée côté serveur", () => {
  assert.doesNotMatch(prompt, /claim\([^)]*\).*useEffect/s);
  assert.match(
    claimMigration,
    /External participation identity does not match profile/,
  );
  assert.match(
    claimMigration,
    /Account already represents another player in this tournament/,
  );
  assert.match(claimMigration, /status = 'verified'/);
});
