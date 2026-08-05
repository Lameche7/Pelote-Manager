import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { ROUTES } from "@/shared/config";
import { usePlatformAuth } from "../auth/usePlatformAuth";
import "./PlatformPages.css";

export function PlatformLoginPage() {
  const navigate = useNavigate();
  const { isConfigured, isAuthenticated, isAdmin, isLoading, login } =
    usePlatformAuth();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [errorMessage, setErrorMessage] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  useEffect(() => {
    if (!isLoading && isAuthenticated && isAdmin) {
      navigate(ROUTES.platform, { replace: true });
    }
  }, [isAdmin, isAuthenticated, isLoading, navigate]);

  const handleSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setErrorMessage("");
    setIsSubmitting(true);

    try {
      await login(email, password);
      navigate(ROUTES.platform, { replace: true });
    } catch (error) {
      setErrorMessage(
        error instanceof Error ? error.message : "Connexion impossible.",
      );
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <main className="platform-page platform-page--centered">
      <section className="platform-card platform-login-card">
        <p className="platform-kicker">Pelote Manager · Propriétaire</p>
        <h1>Super administration</h1>
        <p>
          Cet accès est indépendant des comptes administrateurs et licenciés des
          clubs.
        </p>

        {!isConfigured ? (
          <div className="platform-message platform-message--warning">
            La base centrale n’est pas encore configurée sur ce déploiement.
          </div>
        ) : (
          <form className="platform-form" onSubmit={handleSubmit}>
            <label>
              Adresse email
              <input
                type="email"
                autoComplete="username"
                required
                value={email}
                onChange={(event) => setEmail(event.target.value)}
              />
            </label>
            <label>
              Mot de passe
              <input
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(event) => setPassword(event.target.value)}
              />
            </label>
            {errorMessage && (
              <div className="platform-message platform-message--error">
                {errorMessage}
              </div>
            )}
            <button
              className="button button--primary"
              type="submit"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Connexion…" : "Se connecter"}
            </button>
          </form>
        )}

        <Link className="text-link" to={ROUTES.home}>
          Retour à l’application du club
        </Link>
      </section>
    </main>
  );
}
