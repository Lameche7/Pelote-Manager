export type ReservationTerms = {
  customerType: "guest" | "account" | "licensee";
  advanceHours: number;
  priceCents: number;
  maxActiveReservations: number;
};

export type GuestContact = {
  name: string;
  email: string;
  phone: string;
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

export type BookingFormErrors = Partial<Record<keyof GuestContact, string>>;

export function formatPrice(priceCents: number): string {
  return new Intl.NumberFormat("fr-FR", {
    style: "currency",
    currency: "EUR",
  }).format(priceCents / 100);
}

export function validateGuestContact(contact: GuestContact): BookingFormErrors {
  const errors: BookingFormErrors = {};

  if (contact.name.trim().length < 2) {
    errors.name = "Indiquez votre nom complet.";
  }

  if (!/^\S+@\S+\.\S+$/.test(contact.email.trim())) {
    errors.email = "Indiquez une adresse électronique valide.";
  }

  const digits = contact.phone.replace(/\D/g, "");
  if (digits.length < 10) {
    errors.phone = "Indiquez un numéro de téléphone valide.";
  }

  return errors;
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
