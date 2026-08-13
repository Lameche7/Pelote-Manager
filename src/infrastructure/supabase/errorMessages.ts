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
  if (code === "42501") {
    return "Vous n’êtes pas autorisé à effectuer cette action.";
  }
  if (code === "23505") return "Ces informations sont déjà utilisées.";
  if (code === "23P01") {
    return "Ce créneau vient d’être réservé par une autre personne.";
  }

  return fallback;
}
