import { useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { updatePassword } from "@/infrastructure/auth/authService";
import { ROUTES } from "@/shared/config";
import { publicClubQuery } from "@/shared/config/domains";

export function ResetPasswordPage() {
  const navigate = useNavigate();
  const location = useLocation();
  const clubQuery = publicClubQuery(
    new URLSearchParams(location.search).get("club"),
  );
  const [password, setPassword] = useState("");
  const [confirmation, setConfirmation] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    if (password !== confirmation) {
      setError("Les deux mots de passe ne correspondent pas.");
      return;
    }
    setIsSubmitting(true);
    try {
      await updatePassword(password);
      navigate(`${ROUTES.login}${clubQuery}`, {
        replace: true,
        state: { passwordReset: true },
      });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "Impossible de modifier le mot de passe.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="simple-page" aria-labelledby="reset-password-title">
      <h1 id="reset-password-title">Nouveau mot de passe</h1>
      <form onSubmit={(event) => void handleSubmit(event)}>
        <label htmlFor="new-password">Nouveau mot de passe</label>
        <input
          id="new-password"
          type="password"
          autoComplete="new-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          minLength={8}
          required
        />
        <label htmlFor="confirm-password">Confirmer le mot de passe</label>
        <input
          id="confirm-password"
          type="password"
          autoComplete="new-password"
          value={confirmation}
          onChange={(event) => setConfirmation(event.target.value)}
          minLength={8}
          required
        />
        <small>8 caractères minimum.</small>
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Modification…" : "Modifier le mot de passe"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
      <p>
        <Link to={`${ROUTES.login}${clubQuery}`}>
          Retour à la connexion
        </Link>
      </p>
    </section>
  );
}
