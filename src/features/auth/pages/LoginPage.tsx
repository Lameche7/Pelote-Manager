import { useState } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { Link, useLocation } from "react-router-dom";
import { ROUTES } from "@/shared/config";
import { useAuth } from "@/shared/hooks/useAuth";
import { useFinalizeMemberRegistration } from "@/features/members/hooks/useMemberLookup";

export function LoginPage() {
  const { isAuthenticated, login, refreshProfile } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const finalization = useFinalizeMemberRegistration();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (isAuthenticated) {
    return <Navigate to={ROUTES.home} replace />;
  }

  async function handleLogin(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSubmitting(true);
    setError(null);

    try {
      await login(email, password);
      const finalized = await finalization.mutateAsync();
      if (finalized) await refreshProfile();
      navigate(ROUTES.home, { replace: true });
    } catch (caughtError) {
      setError(
        caughtError instanceof Error
          ? caughtError.message
          : "La connexion a échoué. Veuillez réessayer.",
      );
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="simple-page" aria-labelledby="login-title">
      <h1 id="login-title">Connexion</h1>
      {location.state?.accountCreated === "completed" && (
        <p role="status">
          Votre compte a bien été créé. Vous pouvez maintenant vous connecter.
        </p>
      )}
      {location.state?.accountCreated === "confirmation_required" && (
        <p role="status">
          Votre compte a été créé. Un email de confirmation vient de vous être
          envoyé. Cliquez sur le lien reçu avant de vous connecter.
        </p>
      )}
      <form onSubmit={(event) => void handleLogin(event)}>
        <label htmlFor="email">Adresse e-mail</label>
        <input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />
        <label htmlFor="password">Mot de passe</label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />
        <button type="submit" disabled={isSubmitting}>
          {isSubmitting ? "Connexion…" : "Se connecter"}
        </button>
        {error && <p role="alert">{error}</p>}
      </form>
      <p>
        Pas encore de compte ?{" "}
        <Link to={ROUTES.register}>Créer un compte licencié</Link>
      </p>
    </section>
  );
}
