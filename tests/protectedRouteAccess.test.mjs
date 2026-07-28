import assert from "node:assert/strict";
import test from "node:test";
import { getProtectedRouteAccess } from "../.test-dist/src/app/router/protectedRouteAccess.js";
import { USER_ROLES } from "../.test-dist/src/shared/config/roles.js";

const adminOnly = [USER_ROLES.admin];

test("attend le profil avant de décider d'une redirection", () => {
  assert.equal(
    getProtectedRouteAccess({
      isLoading: true,
      isAuthenticated: false,
      role: null,
      allowedRoles: adminOnly,
    }),
    "loading",
  );
});

test("redirige selon l'authentification et le rôle du profil", () => {
  assert.equal(
    getProtectedRouteAccess({
      isLoading: false,
      isAuthenticated: false,
      role: null,
      allowedRoles: adminOnly,
    }),
    "login",
  );
  assert.equal(
    getProtectedRouteAccess({
      isLoading: false,
      isAuthenticated: true,
      role: USER_ROLES.member,
      allowedRoles: adminOnly,
    }),
    "forbidden",
  );
  assert.equal(
    getProtectedRouteAccess({
      isLoading: false,
      isAuthenticated: true,
      role: USER_ROLES.admin,
      allowedRoles: adminOnly,
    }),
    "allowed",
  );
});

test("autorise une route sans restriction de rôle", () => {
  assert.equal(
    getProtectedRouteAccess({
      isLoading: false,
      isAuthenticated: true,
      role: USER_ROLES.visitor,
    }),
    "allowed",
  );
});
