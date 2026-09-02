type SupabaseLikeError = {
  message?: string;
  code?: string;
  status?: number;
};

const RATE_LIMIT_MESSAGE =
  "Trop de tentatives ont été effectuées. Merci de patienter quelques minutes avant de réessayer.";

const RESCHEDULE_CREATE_FALLBACK =
  "Impossible de créer la demande de report.";

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

  // Diagnostic temporaire PR127. Les RPC Supabase sont appelées directement
  // depuis le navigateur et ne remontent pas dans les logs runtime Vercel.
  // Pour la création d'un report, on affiche uniquement code + message : pas
  // de payload, de hint, de détails SQL ou d'identifiant supplémentaire.
  if (fallback === RESCHEDULE_CREATE_FALLBACK && message.trim()) {
    const diagnosticCode = code ? ` [${code}]` : "";
    return `${fallback} Diagnostic${diagnosticCode} : ${message.trim()}`;
  }

  return fallback;
}
