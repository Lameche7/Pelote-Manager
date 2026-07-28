import assert from "node:assert/strict";
import test from "node:test";
import {
  filterAdminProfiles,
  getProfileDisplayName,
  USER_ROLE_LABELS,
} from "../.test-dist/src/features/admin/utils/adminUsers.js";
import { USER_ROLES } from "../.test-dist/src/shared/config/roles.js";

const profiles = [
  {
    id: "1",
    email: "alain@example.fr",
    firstName: "Alain",
    lastName: "Guemeche",
    role: USER_ROLES.admin,
    createdAt: "2026-07-01T10:00:00Z",
    updatedAt: "2026-07-01T10:00:00Z",
  },
  {
    id: "2",
    email: "marie@example.fr",
    displayName: "Marie Dupont",
    role: USER_ROLES.member,
    createdAt: "2026-07-02T10:00:00Z",
    updatedAt: "2026-07-02T10:00:00Z",
  },
];

test("affiche le meilleur nom disponible", () => {
  assert.equal(getProfileDisplayName(profiles[0]), "Alain Guemeche");
  assert.equal(getProfileDisplayName(profiles[1]), "Marie Dupont");
});

test("filtre par texte sans tenir compte de la casse", () => {
  assert.deepEqual(filterAdminProfiles(profiles, "GUEMECHE", "all"), [profiles[0]]);
  assert.deepEqual(filterAdminProfiles(profiles, "licencié", "all"), [profiles[1]]);
});

test("filtre par rôle", () => {
  assert.deepEqual(
    filterAdminProfiles(profiles, "", USER_ROLES.admin),
    [profiles[0]],
  );
  assert.equal(USER_ROLE_LABELS[USER_ROLES.member], "Licencié");
});
