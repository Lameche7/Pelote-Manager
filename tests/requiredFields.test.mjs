import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(new URL(path, import.meta.url), "utf8");

const [
  component,
  styles,
  main,
  login,
  register,
  platformLogin,
  profile,
  licence,
  splitPayment,
  tournamentRegistration,
  tournamentAvailability,
] = await Promise.all([
  read("../src/shared/components/forms/RequiredField.tsx"),
  read("../src/styles/forms.css"),
  read("../src/main.tsx"),
  read("../src/features/auth/pages/LoginPage.tsx"),
  read("../src/features/auth/pages/RegisterPage.tsx"),
  read("../src/features/platform/pages/PlatformLoginPage.tsx"),
  read("../src/features/user-space/profile/pages/MyProfilePage.tsx"),
  read("../src/features/licences/pages/MyLicencePage.tsx"),
  read(
    "../src/features/reservations/components/ReservationSplitPaymentFields.tsx",
  ),
  read("../src/features/tournaments/components/TournamentRegistrationForm.tsx"),
  read("../src/features/tournaments/components/TournamentAvailabilityGrid.tsx"),
]);

test("fournit une étoile et une légende communes pour les champs obligatoires", () => {
  assert.match(component, /RequiredFieldMark/);
  assert.match(component, /RequiredFieldsNotice/);
  assert.match(component, /Champ obligatoire/);
  assert.match(component, /Champs obligatoires/);
  assert.match(component, /aria-hidden="true"/);
});

test("met visuellement en évidence les contrôles required et invalides", () => {
  assert.match(styles, /\[required\]/);
  assert.match(styles, /--form-required/);
  assert.match(styles, /\[aria-invalid="true"\]/);
  assert.match(styles, /\.field-error/);
});

test("charge les styles de formulaire au démarrage de l'application", () => {
  assert.match(main, /\.\/styles\/forms\.css/);
});

test("signale les champs obligatoires dans les parcours d'authentification", () => {
  assert.match(login, /Adresse e-mail <RequiredFieldMark \/>/);
  assert.match(login, /Mot de passe <RequiredFieldMark \/>/);
  assert.match(login, /<RequiredFieldsNotice \/>/);

  assert.match(register, /Numéro de licence <RequiredFieldMark \/>/);
  assert.match(register, /Date de naissance <RequiredFieldMark \/>/);
  assert.match(register, /Adresse email <RequiredFieldMark \/>/);
  assert.match(register, /Confirmer le mot de passe <RequiredFieldMark \/>/);
  assert.match(register, /<RequiredFieldsNotice \/>/);

  assert.match(platformLogin, /Adresse email <RequiredFieldMark \/>/);
  assert.match(platformLogin, /Mot de passe <RequiredFieldMark \/>/);
  assert.match(platformLogin, /<RequiredFieldsNotice \/>/);
});

test("signale les champs obligatoires du rattachement de licence dans Mon profil", () => {
  assert.match(profile, /Numéro de licence <RequiredFieldMark \/>/);
  assert.match(profile, /Nom <RequiredFieldMark \/>/);
  assert.match(profile, /Prénom <RequiredFieldMark \/>/);
  assert.match(profile, /Date de naissance <RequiredFieldMark \/>/);
  assert.match(profile, /<RequiredFieldsNotice \/>/);
});

test("signale les champs obligatoires dans Ma licence", () => {
  assert.match(licence, /Prénom <RequiredFieldMark \/>/);
  assert.match(licence, /Nom <RequiredFieldMark \/>/);
  assert.match(licence, /Date de naissance <RequiredFieldMark \/>/);
  assert.match(licence, /Sexe <RequiredFieldMark \/>/);
  assert.match(licence, /Document à déposer <RequiredFieldMark \/>/);
  assert.match(licence, /Téléphone\s*\n\s*<input name="phone" type="tel" \/>/);
  assert.match(licence, /<RequiredFieldsNotice \/>/);
});

test("signale la sélection obligatoire des joueurs pour un paiement partagé", () => {
  assert.match(
    splitPayment,
    /Choisissez les 3 autres joueurs <RequiredFieldMark \/>/,
  );
  assert.match(splitPayment, /<RequiredFieldsNotice \/>/);
  assert.match(splitPayment, /Rechercher un joueur/);
});

test("signale les champs obligatoires de l'inscription tournoi", () => {
  assert.match(tournamentRegistration, /Série <RequiredFieldMark \/>/);
  assert.match(
    tournamentRegistration,
    /Votre prénom <RequiredFieldMark \/>/,
  );
  assert.match(tournamentRegistration, /Votre nom <RequiredFieldMark \/>/);
  assert.match(tournamentRegistration, /Votre club <RequiredFieldMark \/>/);
  assert.match(tournamentRegistration, /Votre e-mail <RequiredFieldMark \/>/);
  assert.match(
    tournamentRegistration,
    /Votre téléphone <RequiredFieldMark \/>/,
  );
  assert.match(
    tournamentRegistration,
    /Prénom du partenaire <RequiredFieldMark \/>/,
  );
  assert.match(
    tournamentRegistration,
    /Nom du partenaire <RequiredFieldMark \/>/,
  );
  assert.match(
    tournamentRegistration,
    /Club du partenaire <RequiredFieldMark \/>/,
  );
  assert.match(
    tournamentRegistration,
    /!partnerEmailFromMember && <RequiredFieldMark \/>/,
  );
  assert.match(
    tournamentRegistration,
    /!partnerPhoneFromMember && <RequiredFieldMark \/>/,
  );
  assert.match(tournamentRegistration, /<RequiredFieldsNotice \/>/);
  assert.match(
    tournamentRegistration,
    /Commentaire pour l’organisateur\s*\n\s*<textarea/,
  );
});

test(
  "signale les disponibilités obligatoires uniquement côté inscription tournoi",
  () => {
    assert.match(tournamentAvailability, /!admin && \(/);
    assert.match(tournamentAvailability, /<RequiredFieldMark \/>/);
    assert.match(tournamentAvailability, /minimumAvailabilitySlots/);
    assert.match(tournamentAvailability, /minimumWeekendAvailabilitySlots/);
    assert.match(tournamentAvailability, /minimumFinalsAvailabilitySlots/);
  },
);
