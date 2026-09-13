type SupabaseLikeError = { message?: string; code?: string; status?: number };

const RATE_LIMIT_MESSAGE =
  "Trop de tentatives ont été effectuées. Merci de patienter quelques minutes avant de réessayer.";

/** Prevents infrastructure details and English Supabase errors from reaching users. */
export function getSupabaseErrorMessage(
  error: unknown,
  fallback = "Une erreur est survenue. Merci de réessayer.",
): string {
  if (!error || typeof error !== "object") return fallback;
  const { message = "", code, status } = error as SupabaseLikeError;
  const normalized = message.toLowerCase();

  if (
    status === 429 ||
    normalized.includes("rate limit") ||
    normalized.includes("too many requests")
  ) {
    return RATE_LIMIT_MESSAGE;
  }
  if (
    normalized.includes("already registered") ||
    normalized.includes("already been registered")
  ) {
    return "Cette adresse email est déjà utilisée.";
  }
  if (normalized.includes("invalid login credentials")) {
    return "Adresse email ou mot de passe incorrect.";
  }
  if (normalized.includes("email not confirmed")) {
    return "Veuillez confirmer votre adresse email avant de vous connecter.";
  }
  if (
    normalized.includes("password") &&
    (normalized.includes("weak") || normalized.includes("least"))
  ) {
    return "Le mot de passe ne respecte pas les critères de sécurité.";
  }
  if (normalized.includes("délai d’annulation en ligne est dépassé")) {
    return "L’annulation n’est plus possible : le délai autorisé avant le créneau est dépassé.";
  }

  if (normalized.includes("paramètres du créneau permanent invalides")) {
    return "Le créneau permanent n’est pas valide. Vérifiez le jour, l’horaire, la période et le délai de gestion.";
  }
  if (normalized.includes("terrain invalide")) {
    return "Le terrain sélectionné n’est pas disponible pour ce créneau permanent.";
  }
  if (
    normalized.includes(
      "le titulaire principal doit posséder un compte pilotoki",
    )
  ) {
    return "Le titulaire principal doit posséder un compte PILOTOKI.";
  }
  if (
    normalized.includes(
      "un gestionnaire sélectionné ne possède pas de compte pilotoki",
    )
  ) {
    return "Un des gestionnaires sélectionnés ne possède pas de compte PILOTOKI.";
  }
  if (
    normalized.includes(
      "le créneau permanent doit avoir la durée de réservation configurée",
    )
  ) {
    const duration = message.match(/\((\d+)\s*min\)/i)?.[1];
    return duration
      ? `Ce créneau permanent doit durer ${duration} minutes.`
      : "La durée du créneau permanent ne correspond pas à la durée de réservation configurée.";
  }
  if (
    normalized.includes("impossible de créer le créneau permanent : conflit le")
  ) {
    const conflictDate = message.match(
      /conflit le\s+(\d{2}\/\d{2}\/\d{4})/i,
    )?.[1];
    return conflictDate
      ? `Impossible de créer ce créneau permanent : le terrain est déjà occupé le ${conflictDate}.`
      : "Impossible de créer ce créneau permanent : au moins une occurrence est déjà occupée.";
  }

  if (code === "PGRST202") {
    return "Cette fonction vient d’être ajoutée mais n’est pas encore visible par l’API. Rechargez le schéma Supabase puis réessayez.";
  }
  if (code === "42883" || code === "42703" || code === "42P01") {
    return "La base de données n’est pas encore au même niveau que cette version de Pelote Manager. Vérifiez les dernières migrations Supabase puis réessayez.";
  }
  if (code === "42501") {
    return "Vous n’êtes pas autorisé à effectuer cette action.";
  }
  if (code === "23505") return "Ces informations sont déjà utilisées.";
  if (code === "23P01") {
    return "Ce créneau vient d’être réservé par une autre personne.";
  }

  return fallback;
}
