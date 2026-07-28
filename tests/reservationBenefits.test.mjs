import assert from "node:assert/strict";
import test from "node:test";
import {
  getReservationOpeningTime,
  resolveReservationBenefits,
} from "../.test-dist/src/features/reservations/domain/reservationBenefits.js";

const settings = {
  licenseeAdvanceHours: 72,
  publicAdvanceHours: 48,
  licenseePriceCents: 1200,
  publicPriceCents: 1800,
};

test("accorde 72 heures et 12 euros à un licencié actif validé", () => {
  assert.deepEqual(
    resolveReservationBenefits(
      {
        hasAccount: true,
        membershipStatus: "active",
        membershipValidatedAt: "2026-07-28T12:00:00Z",
        membershipValidatedBy: "admin-id",
        membershipValidUntil: "2027-06-30",
      },
      "2026-08-15",
      settings,
    ),
    {
      customerType: "licensee",
      advanceHours: 72,
      priceCents: 1200,
    },
  );
});

test("applique 48 heures et 18 euros à un compte non licencié", () => {
  assert.deepEqual(
    resolveReservationBenefits(
      {
        hasAccount: true,
        membershipStatus: "pending",
      },
      "2026-08-15",
      settings,
    ),
    {
      customerType: "account",
      advanceHours: 48,
      priceCents: 1800,
    },
  );
});

test("applique les conditions publiques à un visiteur sans compte", () => {
  assert.deepEqual(
    resolveReservationBenefits(
      { hasAccount: false },
      "2026-08-15",
      settings,
    ),
    {
      customerType: "guest",
      advanceHours: 48,
      priceCents: 1800,
    },
  );
});

test("retire les avantages si la licence est expirée, suspendue ou non validée", () => {
  const customers = [
    {
      hasAccount: true,
      membershipStatus: "expired",
      membershipValidatedAt: "2026-01-01T12:00:00Z",
      membershipValidatedBy: "admin-id",
    },
    {
      hasAccount: true,
      membershipStatus: "suspended",
      membershipValidatedAt: "2026-01-01T12:00:00Z",
      membershipValidatedBy: "admin-id",
    },
    {
      hasAccount: true,
      membershipStatus: "active",
      membershipValidatedAt: null,
      membershipValidatedBy: null,
    },
    {
      hasAccount: true,
      membershipStatus: "active",
      membershipValidatedAt: "2026-01-01T12:00:00Z",
      membershipValidatedBy: "admin-id",
      membershipValidUntil: "2026-07-31",
    },
  ];

  for (const customer of customers) {
    assert.equal(
      resolveReservationBenefits(customer, "2026-08-15", settings).priceCents,
      1800,
    );
  }
});

test("calcule l'ouverture du créneau à partir de la fenêtre configurée", () => {
  const startsAt = new Date("2026-08-15T18:00:00Z");

  assert.equal(
    getReservationOpeningTime(startsAt, 72).toISOString(),
    "2026-08-12T18:00:00.000Z",
  );
  assert.equal(
    getReservationOpeningTime(startsAt, 48).toISOString(),
    "2026-08-13T18:00:00.000Z",
  );
});
