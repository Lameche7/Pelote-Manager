import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (file) => readFile(new URL(file, import.meta.url), "utf8");

test("inscription des clubs : demande sans paiement ni création de club", async () => {
  const [sql, page, router, pricing, privacy] = await Promise.all([
    read(
      "../supabase/migrations/20261104105000_network_club_registration_requests.sql",
    ),
    read("../src/features/network/pages/NetworkClubRegistrationPage.tsx"),
    read("../src/app/router.tsx"),
    read("../src/features/network/pages/NetworkPublicPages.tsx"),
    read("../src/features/legal/pages/LegalPage.tsx"),
  ]);
  assert.match(sql, /network_club_registration_requests/);
  assert.match(sql, /enable row level security/);
  assert.match(
    sql,
    /revoke all on public\.network_club_registration_requests/,
  );
  assert.match(
    sql,
    /grant execute on function public\.submit_network_club_registration_request/,
  );
  assert.match(sql, /pg_catalog\.pg_advisory_xact_lock/);
  assert.match(sql, /interval '24 hours'/);
  assert.match(sql, /target_privacy_accepted is distinct from true/);
  assert.match(page, /submit_network_club_registration_request/);
  assert.match(page, /target_plan: plan/);
  assert.match(page, /Envoyer ma demande/);
  assert.match(pricing, /reseau\/inscription\?formule=/);
  assert.match(router, /path: "\/reseau\/inscription"/);
  assert.match(privacy, /Demandes d'inscription de nouveaux clubs/);
  assert.doesNotMatch(page, /createClub|requestProvisioning|stripe\.com/);
});
