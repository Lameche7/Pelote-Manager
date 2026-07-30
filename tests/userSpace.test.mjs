import assert from "node:assert/strict";
import test from "node:test";
import {
  accountTypeLabels,
  getGreeting,
} from "../.test-dist/src/features/user-space/domain/userSpace.js";
import { USER_ROLES } from "../.test-dist/src/shared/config/roles.js";

test("personnalise le titre de l’espace avec le prénom", () => {
  assert.equal(getGreeting("Camille"), "Bonjour Camille 👋");
  assert.equal(getGreeting(), "Bonjour !");
});

test("affiche les types de compte attendus", () => {
  assert.equal(accountTypeLabels[USER_ROLES.member], "Licencié");
  assert.equal(accountTypeLabels[USER_ROLES.visitor], "Visiteur");
  assert.equal(accountTypeLabels[USER_ROLES.admin], "Administrateur");
});
