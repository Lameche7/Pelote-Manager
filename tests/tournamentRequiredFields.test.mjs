import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const registration = await read(
  "../src/features/tournaments/components/TournamentRegistrationForm.tsx",
);
const availability = await read(
  "../src/features/tournaments/components/TournamentAvailabilityGrid.tsx",
);

test("signale les champs obligatoires de l'inscription tournoi", () => {
  const requiredLabels = [
    "Série <RequiredFieldMark />",
    "Votre prénom <RequiredFieldMark />",
    "Votre nom <RequiredFieldMark />",
    "Votre club <RequiredFieldMark />",
    "Votre e-mail <RequiredFieldMark />",
    "Votre téléphone <RequiredFieldMark />",
    "Prénom du partenaire <RequiredFieldMark />",
    "Nom du partenaire <RequiredFieldMark />",
    "Club du partenaire <RequiredFieldMark />",
  ];

  for (const label of requiredLabels) {
    assert.ok(registration.includes(label), `Marque absente pour ${label}`);
  }

  assert.ok(registration.includes("<RequiredFieldsNotice />"));
  assert.ok(
    registration.includes("!partnerEmailFromMember && <RequiredFieldMark />"),
  );
  assert.ok(
    registration.includes("!partnerPhoneFromMember && <RequiredFieldMark />"),
  );
  assert.ok(registration.includes("Commentaire pour l’organisateur"));
});

test("signale le minimum de disponibilités comme obligatoire", () => {
  assert.ok(availability.includes("!admin && ("));
  assert.ok(availability.includes("<RequiredFieldMark />"));
  assert.ok(availability.includes("minimumAvailabilitySlots"));
  assert.ok(availability.includes("minimumWeekendAvailabilitySlots"));
  assert.ok(availability.includes("minimumFinalsAvailabilitySlots"));
});
