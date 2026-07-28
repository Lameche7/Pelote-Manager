import assert from "node:assert/strict";
import test from "node:test";
import {
  isUserRole,
  parseUserRole,
  USER_ROLES,
} from "../.test-dist/src/shared/config/roles.js";

test("reconnaît tous les rôles applicatifs", () => {
  for (const role of Object.values(USER_ROLES)) {
    assert.equal(isUserRole(role), true);
    assert.equal(parseUserRole(role), role);
  }
});

test("refuse un rôle vide ou inconnu", () => {
  for (const role of ["", "super-admin", null, 1]) {
    assert.equal(isUserRole(role), false);
    assert.throws(() => parseUserRole(role), /rôle utilisateur inconnu/);
  }
});
