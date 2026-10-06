import { useState } from "react";
import { Link } from "react-router-dom";
import { requestPasswordReset } from "@/infrastructure/auth/authService";
import { ROUTES } from "@/shared/config";

export function ForgotPasswordPage() {
  const [email, setEmail] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);
    try {
      await requestPasswordReset(email);
      setSent(true);
    } catch (caughtError) {
      setError(caughtError instanceof Error ? caughtError.message : "Impossible d’envoyer l’email. Merci de réessayer.");
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="simple-page" aria-labelledby="forgot-password-title">
      <h1 id="forgot-password-title">Mot de passe oublié</h1>
      {sent ? (
        <>
          <p role="status">Si un compte existe pour cette adresse, un lien de réinitialisation vient d’être envoyé. Vérifiez aussi vos courriers indésirables.</p>
          <p><Link to={ROUTES.login}>Retour à la connexion</Link></p>
        </>
      ) : (
        <form onSubmit={(event) => void handleSubmit(event)}>
          <label htmlFor="reset-email">Adresse e-mail</label>
          <input id="reset-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} required />
          <button type="submit" disabled={isSubmitting}>{isSubmitting ? "Envoi…" : "Envoyer le lien"}</button>
          {error && <p role="alert">{error}</p>}
        </form>
      )}
    </section>
  );
}
