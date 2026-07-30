export type ReservationTerms = {
  customerType: "guest" | "account" | "licensee";
  advanceHours: number;
  priceCents: number;
  maxActiveReservations: number;
};

export type CreatedReservation = {
  id: string;
  resourceId: string;
  startsAt: string;
  endsAt: string;
  customerType: ReservationTerms["customerType"];
  status: "confirmed";
  priceCents: number;
  currency: "EUR";
};

export function formatPrice(priceCents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(priceCents / 100);
}

export function getBookingErrorMessage(error: unknown): string {
  const message =
    typeof error === "object" && error !== null && "message" in error
      ? String(error.message)
      : "";

  if (message.includes("déjà occupé") || message.includes("autre personne")) {
    return "Ce créneau vient d’être réservé. Le calendrier a été actualisé.";
  }

  if (message.includes("pas encore ouvert")) {
    return "Ce créneau n’est pas encore ouvert à la réservation.";
  }

  if (message.includes("délai minimum")) {
    return "Il est trop tard pour réserver ce créneau en ligne.";
  }

  if (message.includes("nombre maximal")) {
    return "Vous avez atteint le nombre maximal de réservations actives.";
  }

  if (message.includes("obligatoires")) {
    return "Complétez vos coordonnées avant de confirmer.";
  }

  return "La réservation n’a pas pu être enregistrée. Réessayez dans quelques instants.";
}
