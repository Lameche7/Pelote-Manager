export type MembershipStatus = "pending" | "active" | "expired" | "suspended";

export type ReservationCustomer = {
  hasAccount: boolean;
  membershipStatus?: MembershipStatus;
  membershipValidatedAt?: string | null;
  membershipValidatedBy?: string | null;
  membershipValidUntil?: string | null;
};

export type ReservationSettings = {
  licenseeAdvanceHours: number;
  publicAdvanceHours: number;
  licenseePriceCents: number;
  publicPriceCents: number;
};

export type ReservationBenefits = {
  customerType: "guest" | "account" | "licensee";
  advanceHours: number;
  priceCents: number;
};

function isMembershipValidOnDate(
  customer: ReservationCustomer,
  reservationDate: string,
): boolean {
  if (!customer.hasAccount || customer.membershipStatus !== "active") {
    return false;
  }

  if (!customer.membershipValidatedAt || !customer.membershipValidatedBy) {
    return false;
  }

  return (
    !customer.membershipValidUntil ||
    customer.membershipValidUntil >= reservationDate
  );
}

export function resolveReservationBenefits(
  customer: ReservationCustomer,
  reservationDate: string,
  settings: ReservationSettings,
): ReservationBenefits {
  if (isMembershipValidOnDate(customer, reservationDate)) {
    return {
      customerType: "licensee",
      advanceHours: settings.licenseeAdvanceHours,
      priceCents: settings.licenseePriceCents,
    };
  }

  return {
    customerType: customer.hasAccount ? "account" : "guest",
    advanceHours: settings.publicAdvanceHours,
    priceCents: settings.publicPriceCents,
  };
}

export function getReservationOpeningTime(
  startsAt: Date,
  advanceHours: number,
): Date {
  return new Date(startsAt.getTime() - advanceHours * 60 * 60 * 1000);
}
