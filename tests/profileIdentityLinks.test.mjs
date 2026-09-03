import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const profilePageUrl = new URL(
  "../src/features/user-space/profile/pages/MyProfilePage.tsx",
  import.meta.url,
);
const externalParticipationServiceUrl = new URL(
  "../src/features/auth/services/externalParticipationService.ts",
  import.meta.url,
);
const memberServiceUrl = new URL(
  "../src/features/members/services/memberService.ts",
  import.meta.url,
);

test("Mon profil permet de rechercher et confirmer de nouvelles participations", async () => {
  const [profilePage, externalParticipationService] = await Promise.all([
    readFile(profilePageUrl, "utf8"),
    readFile(externalParticipationServiceUrl, "utf8"),
  ]);

  assert.match(profilePage, /Retrouver mes participations/);
  assert.match(profilePage, /externalParticipationService\.find/);
  assert.match(profilePage, /externalParticipationService\.claim/);
  assert.match(profilePage, /Oui, c’est bien moi/);
  assert.match(profilePage, /candidate\.tournamentName/);
  assert.match(profilePage, /candidate\.seriesName/);
  assert.match(profilePage, /partnerLabel\(candidate\)/);
  assert.match(
    externalParticipationService,
    /find_external_participation_candidates/,
  );
  assert.match(externalParticipationService, /claim_external_participation/);
});

test("la recherche depuis Mon profil utilise l'identité du compte", async () => {
  const profilePage = await readFile(profilePageUrl, "utf8");

  assert.match(profilePage, /profile\.firstName/);
  assert.match(profilePage, /profile\.lastName/);
  assert.match(
    profilePage,
    /externalParticipationService\.find\(\s*profileFirstName,\s*profileLastName/,
  );
});

test("un compte sans licence peut rattacher sa licence sans recréer de compte", async () => {
  const [profilePage, memberService] = await Promise.all([
    readFile(profilePageUrl, "utf8"),
    readFile(memberServiceUrl, "utf8"),
  ]);

  assert.match(profilePage, /Rattacher ma licence/);
  assert.match(profilePage, /memberService\.matchesLicence/);
  assert.match(profilePage, /memberService\.linkCurrentProfile/);
  assert.match(profilePage, /await refreshProfile\(\)/);
  assert.match(memberService, /find_member_by_licence/);
  assert.match(memberService, /link_profile_to_member/);
});

test("le rattachement de licence n'est proposé que tant qu'aucune licence n'est liée", async () => {
  const profilePage = await readFile(profilePageUrl, "utf8");

  assert.match(profilePage, /!hasLinkedLicence &&/);
  assert.match(profilePage, /Boolean\(profile\.memberId\)/);
  assert.match(profilePage, /Vos participations existantes sont conservées/);
});

test("Mon profil distingue les participations déjà rattachées des nouvelles", async () => {
  const [profilePage, externalParticipationService] = await Promise.all([
    readFile(profilePageUrl, "utf8"),
    readFile(externalParticipationServiceUrl, "utf8"),
  ]);

  assert.match(profilePage, /Déjà rattachées à votre compte/);
  assert.match(profilePage, /Nouvelles participations à confirmer/);
  assert.match(
    profilePage,
    /Toutes les participations trouvées sont déjà rattachées/,
  );
  assert.match(profilePage, /externalParticipationService\.listLinked/);
  assert.match(externalParticipationService, /get_my_external_participations/);
});
